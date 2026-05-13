/**
 * API route for raw capture upload + processing.
 *
 *   POST  intent=signRawUpload     — mint a Capture row + signed PUT URL
 *   POST  intent=recordRawUpload   — flip QUEUED + enqueue process_capture job
 *   GET   ?captureId=...            — poll a single capture's status
 *   GET   ?productGid=...           — latest capture for a product (poll target)
 *
 * Auth: dual — either Shopify embedded session or `CLI_ADMIN_TOKEN` bearer.
 * See app/lib/admin-auth.server.ts for the contract.
 */
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";
import { withAdminAuth, type AuthenticatedAdmin } from "../lib/admin-auth.server";
import { defaultViewerSettings } from "../lib/sdl3d-shared";
import {
  getDefaultStorageRowId,
  loadStorageForShopById,
} from "../lib/storage.server";
import {
  DEFAULT_FRAME_COUNT_TARGET,
  rawCaptureKey,
  type CaptureStatus,
} from "../lib/captures-shared";
import { enqueue, JOB_NAMES } from "../lib/queue.server";
import type { ProcessCaptureJobData } from "../lib/capture-pipeline/orchestrator";

function json(data: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function captureToWire(row: {
  id: string;
  productConfigId: string;
  status: string;
  rawKey: string;
  rawSizeBytes: number | null;
  frameCountTarget: number;
  frameCountActual: number | null;
  errorMessage: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    productConfigId: row.productConfigId,
    status: row.status as CaptureStatus,
    rawKey: row.rawKey,
    rawSizeBytes: row.rawSizeBytes,
    frameCountTarget: row.frameCountTarget,
    frameCountActual: row.frameCountActual,
    errorMessage: row.errorMessage,
    startedAt: row.startedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function ensureDraftConfig(shopId: string, productGid: string) {
  return prisma.productConfig.upsert({
    where: {
      shopId_shopifyProductGid: { shopId, shopifyProductGid: productGid },
    },
    update: {},
    create: {
      shopId,
      shopifyProductGid: productGid,
      enabled: false,
      sourceMode: "APP",
      status: "DRAFT",
      viewerType: "IMAGE_360",
      viewerSettingsJson: JSON.stringify(defaultViewerSettings),
    },
  });
}

export async function loader({ request }: LoaderFunctionArgs) {
  return withAdminAuth(request, async (auth) => {
    const url = new URL(request.url);
    const captureId = url.searchParams.get("captureId");
    const productGid = url.searchParams.get("productGid");

    if (captureId) {
      const row = await prisma.capture.findUnique({
        where: { id: captureId },
        include: { productConfig: true },
      });
      if (!row) return json({ ok: false, message: "Capture not found." }, 404);
      if (row.productConfig.shopId !== auth.shop.id) {
        return json({ ok: false, message: "Capture not found." }, 404);
      }
      return json({ ok: true, capture: captureToWire(row) });
    }

    if (productGid) {
      const config = await prisma.productConfig.findUnique({
        where: {
          shopId_shopifyProductGid: { shopId: auth.shop.id, shopifyProductGid: productGid },
        },
        include: {
          captures: { orderBy: { createdAt: "desc" }, take: 1 },
        },
      });
      const latest = config?.captures[0];
      return json({
        ok: true,
        capture: latest ? captureToWire(latest) : null,
      });
    }

    return json({ ok: false, message: "Provide captureId or productGid." }, 400);
  });
}

export async function action({ request }: ActionFunctionArgs) {
  return withAdminAuth(request, async (auth) => {
    const formData = await request.formData();
    const intent = String(formData.get("intent") || "");

    switch (intent) {
      case "signRawUpload":
        return handleSignRawUpload(auth, formData);
      case "recordRawUpload":
        return handleRecordRawUpload(auth, formData);
      case "retry":
        return handleRetry(auth, formData);
      default:
        return json({ ok: false, message: "Unknown captures intent." }, 400);
    }
  });
}

async function handleSignRawUpload(
  auth: AuthenticatedAdmin,
  formData: FormData,
): Promise<Response> {
  const productGid = String(formData.get("productGid") || "").trim();
  const rawSizeBytesRaw = String(formData.get("rawSizeBytes") || "").trim();
  const frameCountTargetRaw = String(formData.get("frameCountTarget") || "").trim();

  if (!productGid) {
    return json({ ok: false, message: "Missing productGid." }, 400);
  }

  // Resolve the shop's default storage row up front so we can stamp the
  // Capture with its id — the worker reads from that specific bucket later,
  // even if the merchant flips the default mid-job.
  const storageId = await getDefaultStorageRowId(auth.shop.id);
  if (!storageId) {
    return json(
      {
        ok: false,
        message: "Storage credentials not configured. Open Settings → Storage and connect a bucket first.",
        needsStorageSetup: true,
      },
      400,
    );
  }
  const backend = await loadStorageForShopById(auth.shop.id, storageId);
  if (!backend) {
    // Race: row was deleted between the id lookup and the load. Surface a
    // clean error rather than a 500.
    return json(
      {
        ok: false,
        message: "Default storage was changed mid-request. Please retry.",
        needsStorageSetup: true,
      },
      409,
    );
  }

  const config = await ensureDraftConfig(auth.shop.id, productGid);

  const rawSizeBytes = rawSizeBytesRaw ? Math.max(0, Math.floor(Number(rawSizeBytesRaw))) : null;
  const frameCountTarget = frameCountTargetRaw
    ? Math.max(1, Math.floor(Number(frameCountTargetRaw)))
    : DEFAULT_FRAME_COUNT_TARGET;

  const capture = await prisma.capture.create({
    data: {
      productConfigId: config.id,
      storageId,
      status: "PENDING",
      rawKey: "", // filled in after id is known
      rawSizeBytes: Number.isFinite(rawSizeBytes ?? NaN) ? rawSizeBytes : null,
      frameCountTarget,
    },
  });

  const rawKey = rawCaptureKey(auth.shop.id, capture.id);
  await prisma.capture.update({
    where: { id: capture.id },
    data: { rawKey },
  });

  let signedUrl: string;
  try {
    signedUrl = await backend.signPutUrl({
      key: rawKey,
      contentType: "application/zip",
      expiresInSeconds: 900,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to sign upload URL.";
    await prisma.capture.update({
      where: { id: capture.id },
      data: { status: "FAILED", errorMessage: `Sign upload failed: ${message}` },
    });
    return json({ ok: false, message: `Failed to sign upload URL: ${message}` }, 500);
  }

  return json({
    ok: true,
    captureId: capture.id,
    productConfigId: config.id,
    rawKey,
    uploadUrl: signedUrl,
    uploadMethod: "PUT",
    uploadContentType: "application/zip",
    frameCountTarget,
  });
}

async function handleRecordRawUpload(
  auth: AuthenticatedAdmin,
  formData: FormData,
): Promise<Response> {
  const captureId = String(formData.get("captureId") || "").trim();
  const reportedSizeBytesRaw = String(formData.get("rawSizeBytes") || "").trim();
  if (!captureId) return json({ ok: false, message: "Missing captureId." }, 400);

  const capture = await prisma.capture.findUnique({
    where: { id: captureId },
    include: { productConfig: true },
  });
  if (!capture || capture.productConfig.shopId !== auth.shop.id) {
    return json({ ok: false, message: "Capture not found." }, 404);
  }
  if (capture.status === "QUEUED" || capture.status === "PROCESSING") {
    return json({ ok: true, capture: captureToWire(capture), alreadyQueued: true });
  }
  if (capture.status === "COMPLETED") {
    return json({ ok: true, capture: captureToWire(capture), alreadyCompleted: true });
  }

  const updated = await prisma.capture.update({
    where: { id: capture.id },
    data: {
      status: "QUEUED",
      rawSizeBytes: reportedSizeBytesRaw
        ? Math.max(0, Math.floor(Number(reportedSizeBytesRaw)))
        : capture.rawSizeBytes,
      errorMessage: null,
    },
  });

  const jobData: ProcessCaptureJobData = {
    shopId: auth.shop.id,
    captureId: capture.id,
  };
  try {
    await enqueue(JOB_NAMES.PROCESS_CAPTURE, jobData);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to enqueue job.";
    await prisma.capture.update({
      where: { id: capture.id },
      data: { status: "FAILED", errorMessage: `Enqueue failed: ${message}` },
    });
    return json({ ok: false, message: `Failed to enqueue processing job: ${message}` }, 500);
  }

  return json({ ok: true, capture: captureToWire(updated) });
}

async function handleRetry(
  auth: AuthenticatedAdmin,
  formData: FormData,
): Promise<Response> {
  const captureId = String(formData.get("captureId") || "").trim();
  if (!captureId) return json({ ok: false, message: "Missing captureId." }, 400);

  const capture = await prisma.capture.findUnique({
    where: { id: captureId },
    include: { productConfig: true },
  });
  if (!capture || capture.productConfig.shopId !== auth.shop.id) {
    return json({ ok: false, message: "Capture not found." }, 404);
  }
  if (capture.status === "QUEUED" || capture.status === "PROCESSING") {
    return json({ ok: true, capture: captureToWire(capture), alreadyQueued: true });
  }

  const updated = await prisma.capture.update({
    where: { id: capture.id },
    data: { status: "QUEUED", errorMessage: null, startedAt: null, completedAt: null },
  });

  const jobData: ProcessCaptureJobData = {
    shopId: auth.shop.id,
    captureId: capture.id,
  };
  try {
    await enqueue(JOB_NAMES.PROCESS_CAPTURE, jobData);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to enqueue job.";
    await prisma.capture.update({
      where: { id: capture.id },
      data: { status: "FAILED", errorMessage: `Enqueue failed: ${message}` },
    });
    return json({ ok: false, message: `Failed to enqueue retry: ${message}` }, 500);
  }

  return json({ ok: true, capture: captureToWire(updated) });
}

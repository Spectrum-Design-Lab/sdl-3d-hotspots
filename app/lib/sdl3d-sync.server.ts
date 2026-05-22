import {
  SDL3D_METAFIELD_NAMESPACE,
  SDL3D_KEYS,
  SDL3D_SCHEMA_VERSION,
  HotspotsArraySchema,
  Hotspots360ArraySchema,
  ImageSequenceSchema,
  ViewerSettingsSchema,
  ViewerTypeSchema,
} from "@spectrum-design-lab/shared";
import prisma from "../db.server";
import {
  coerceViewerSettings,
  dbHotspotToPublished,
  defaultViewerSettings,
  publishedHotspotsToCreateMany,
  safeJsonParse,
  type PublishedHotspot,
} from "./sdl3d-serialization.server";
import { normalizeViewerTypeToDb } from "./sdl3d-shared";
import { adminGraphql, ensureShop, type AdminGraphqlClient } from "./sdl3d-graphql.server";
import { resolveImageSequenceUrls } from "./sdl3d-image-sequence.server";
import { resolveImageUrlsByGid } from "./sdl3d-files.server";

const NAMESPACE = SDL3D_METAFIELD_NAMESPACE;

/** Map DB viewer type (uppercase Prisma enum) to wire viewer type (lowercase per shared contract). */
function viewerTypeDbToWire(db: "MODEL_3D" | "IMAGE_360"): "model_3d" | "image_360" {
  return db === "IMAGE_360" ? "image_360" : "model_3d";
}

/** Map wire viewer type (lowercase) to DB viewer type (uppercase). Defaults to MODEL_3D on unknown. */
function viewerTypeWireToDb(wire: string | null | undefined): "MODEL_3D" | "IMAGE_360" {
  return wire === "image_360" ? "IMAGE_360" : "MODEL_3D";
}

function chunk<T>(items: T[], size: number) {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export async function publishConfigToMetafields(args: {
  admin: AdminGraphqlClient;
  shopDomain: string;
  productConfigId: string;
  storefrontMode?: "app" | "metafield";
}) {
  const { admin, shopDomain, productConfigId, storefrontMode = "metafield" } = args;

  const config = await prisma.productConfig.findUnique({
    where: { id: productConfigId },
    include: {
      hotspots: {
        orderBy: { sortOrder: "asc" },
      },
    },
  });

  if (!config) {
    throw new Error(`ProductConfig not found: ${productConfigId}`);
  }

  const shop = await ensureShop(shopDomain);

  const rawViewerSettings = coerceViewerSettings(
    safeJsonParse(config.viewerSettingsJson, defaultViewerSettings),
  );
  // Slice 8 PR #3 — resolve background colour at publish time:
  // productOverride ?? shopDefault ?? hardcoded fallback. TAE keeps
  // reading just the per-product metafield, so once published the
  // value is frozen until next publish (the staleness footgun called
  // out in the plan — a "Republish all" bulk action is a follow-up
  // that would clear it).
  const resolvedBackgroundColor =
    rawViewerSettings.backgroundColor
    ?? shop.defaultViewerBackgroundColor
    ?? defaultViewerSettings.backgroundColor;
  const viewerSettings = {
    ...rawViewerSettings,
    backgroundColor: resolvedBackgroundColor,
  };
  const hotspots = config.hotspots.map(dbHotspotToPublished);

  // Slice 8 hotspots PR #4 + PR #5 — resolve any Shopify file GIDs
  // (icon + mediaImageUrl) to URLs at publish time. TAE has no Admin
  // API at render, so the metafield must carry resolved URLs. Preset
  // names + absolute URLs pass through resolveImageUrlsByGid's
  // prefix filter untouched. One batched call handles both fields
  // across all hotspots.
  const gidsToResolve: string[] = [];
  function collectGid(value: unknown) {
    if (typeof value === "string" && value.startsWith("gid://shopify/")) {
      gidsToResolve.push(value);
    }
  }
  for (const h of hotspots) {
    collectGid(h.icon);
    collectGid(h.mediaImageUrl);
  }
  let hotspots360Parsed: Array<Record<string, unknown>> = [];
  if (config.hotspotsJson360) {
    try {
      const arr = JSON.parse(config.hotspotsJson360);
      if (Array.isArray(arr)) {
        hotspots360Parsed = arr as Array<Record<string, unknown>>;
        for (const h of hotspots360Parsed) {
          collectGid(h.icon);
          collectGid(h.mediaImageUrl);
        }
      }
    } catch { /* malformed — leave as-is, the 360 metafield write below will use the raw string */ }
  }
  const gidUrlMap = gidsToResolve.length
    ? await resolveImageUrlsByGid(admin, gidsToResolve)
    : {};
  function resolveGid(value: unknown): string | null {
    if (typeof value !== "string") return null;
    if (!value.startsWith("gid://shopify/")) return value;
    return gidUrlMap[value] ?? null;
  }
  for (const h of hotspots) {
    if (h.icon && h.icon.startsWith("gid://shopify/")) {
      h.icon = resolveGid(h.icon);
    }
    if (h.mediaImageUrl && h.mediaImageUrl.startsWith("gid://shopify/")) {
      h.mediaImageUrl = resolveGid(h.mediaImageUrl);
    }
  }
  // Round-trip 360 hotspots through the parsed copy so resolved icons +
  // media images land in the published payload. If parsing failed
  // above, fall back to the raw string further down.
  const hotspots360Resolved = hotspots360Parsed.length
    ? hotspots360Parsed.map((h) => {
      const next = { ...h };
      if (typeof h.icon === "string" && h.icon.startsWith("gid://shopify/")) {
        next.icon = resolveGid(h.icon);
      }
      if (typeof h.mediaImageUrl === "string" && h.mediaImageUrl.startsWith("gid://shopify/")) {
        next.mediaImageUrl = resolveGid(h.mediaImageUrl);
      }
      return next;
    })
    : null;

  const viewerType = normalizeViewerTypeToDb(config.viewerType);

  const metafields: Array<Record<string, unknown>> = [
    {
      ownerId: config.shopifyProductGid,
      namespace: NAMESPACE,
      key: SDL3D_KEYS.schemaVersion,
      type: "number_integer",
      value: String(SDL3D_SCHEMA_VERSION),
    },
    {
      ownerId: config.shopifyProductGid,
      namespace: NAMESPACE,
      key: SDL3D_KEYS.enabled,
      type: "boolean",
      value: String(config.enabled),
    },
    {
      ownerId: config.shopifyProductGid,
      namespace: NAMESPACE,
      key: SDL3D_KEYS.mode,
      type: "single_line_text_field",
      value: storefrontMode,
    },
    {
      ownerId: config.shopifyProductGid,
      namespace: NAMESPACE,
      key: SDL3D_KEYS.viewerType,
      type: "single_line_text_field",
      value: viewerTypeDbToWire(viewerType),
    },
    {
      ownerId: config.shopifyProductGid,
      namespace: NAMESPACE,
      key: SDL3D_KEYS.viewerSettings,
      type: "json",
      value: JSON.stringify(viewerSettings),
    },
    {
      ownerId: config.shopifyProductGid,
      namespace: NAMESPACE,
      key: SDL3D_KEYS.hotspots,
      type: "json",
      value: JSON.stringify(hotspots),
    },
  ];

  if (config.modelFileShopifyGid) {
    metafields.push({
      ownerId: config.shopifyProductGid,
      namespace: NAMESPACE,
      key: SDL3D_KEYS.modelFile,
      type: "file_reference",
      value: config.modelFileShopifyGid,
    });
  }

  if (config.posterFileShopifyGid) {
    metafields.push({
      ownerId: config.shopifyProductGid,
      namespace: NAMESPACE,
      key: SDL3D_KEYS.posterFile,
      type: "file_reference",
      value: config.posterFileShopifyGid,
    });
  }

  // 360° image sequence data
  if (viewerType === "IMAGE_360") {
    // Resolve image URLs from Shopify file GIDs before publishing
    const resolvedFrames = config.imageSequenceJson
      ? await resolveImageSequenceUrls({ admin, imageSequenceJson: config.imageSequenceJson })
      : [];

    metafields.push({
      ownerId: config.shopifyProductGid,
      namespace: NAMESPACE,
      key: SDL3D_KEYS.imageSequence,
      type: "json",
      value: JSON.stringify(resolvedFrames),
    });
    metafields.push({
      ownerId: config.shopifyProductGid,
      namespace: NAMESPACE,
      key: SDL3D_KEYS.hotspots360,
      type: "json",
      value: hotspots360Resolved
        ? JSON.stringify(hotspots360Resolved)
        : config.hotspotsJson360 || "[]",
    });
  }

  // Snapshot existing metafield values before writing so we can rollback on partial failure
  let previousValues: Array<Record<string, unknown>> | null = null;
  try {
    previousValues = await fetchCurrentMetafieldValues(admin, config.shopifyProductGid);
  } catch {
    // Non-critical — rollback just won't be possible
  }

  const METAFIELD_MUTATION = `
    mutation PublishSdl3dMetafields($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields { id key }
        userErrors { field message }
      }
    }
  `;

  const chunks = chunk(metafields, 25);
  const CHUNK_RETRIES = 2;

  for (let ci = 0; ci < chunks.length; ci++) {
    let lastError: string | null = null;
    let success = false;

    for (let attempt = 0; attempt <= CHUNK_RETRIES; attempt++) {
      const data = await adminGraphql<{
        metafieldsSet: {
          metafields: Array<{ id: string; key: string }>;
          userErrors: Array<{ field: string[] | null; message: string }>;
        };
      }>(admin, METAFIELD_MUTATION, { metafields: chunks[ci] });

      if (data.metafieldsSet.userErrors.length) {
        lastError = data.metafieldsSet.userErrors.map((e) => e.message).join("; ");
        if (attempt < CHUNK_RETRIES) {
          console.warn(`[sdl3d] Publish chunk ${ci + 1}/${chunks.length} failed (attempt ${attempt + 1}), retrying: ${lastError}`);
          await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
          continue;
        }
      } else {
        success = true;
        break;
      }
    }

    if (!success) {
      // Attempt to rollback previously written chunks
      if (previousValues?.length && ci > 0) {
        try {
          console.warn(`[sdl3d] Rolling back ${ci} previously written chunk(s)`);
          for (const rollbackGroup of chunk(previousValues, 25)) {
            await adminGraphql<unknown>(admin, METAFIELD_MUTATION, { metafields: rollbackGroup });
          }
        } catch (rollbackErr) {
          console.error("[sdl3d] Rollback failed:", rollbackErr);
        }
      }

      await prisma.syncRun.create({
        data: {
          shopId: shop.id,
          shopifyProductGid: config.shopifyProductGid,
          direction: "DB_TO_METAFIELD",
          status: "FAILED",
          message: `Chunk ${ci + 1}/${chunks.length} failed after ${CHUNK_RETRIES + 1} attempts: ${lastError}`,
        },
      });

      throw new Error(lastError ?? "Publish failed");
    }
  }

  await prisma.productConfig.update({
    where: { id: config.id },
    data: {
      status: "PUBLISHED",
      sourceMode: storefrontMode === "metafield" ? "METAFIELD" : "APP",
      storefrontVersion: { increment: 1 },
    },
  });

  await prisma.syncRun.create({
    data: {
      shopId: shop.id,
      shopifyProductGid: config.shopifyProductGid,
      direction: "DB_TO_METAFIELD",
      status: "SUCCESS",
      message: "Published SDL 3D metafields successfully.",
    },
  });

  return { ok: true };
}

const METAFIELD_KEYS: string[] = [
  SDL3D_KEYS.schemaVersion,
  SDL3D_KEYS.enabled,
  SDL3D_KEYS.mode,
  SDL3D_KEYS.viewerType,
  SDL3D_KEYS.viewerSettings,
  SDL3D_KEYS.hotspots,
  SDL3D_KEYS.modelFile,
  SDL3D_KEYS.posterFile,
  SDL3D_KEYS.imageSequence,
  SDL3D_KEYS.hotspots360,
];

async function fetchCurrentMetafieldValues(
  admin: AdminGraphqlClient,
  productGid: string,
): Promise<Array<Record<string, unknown>>> {
  const aliases = METAFIELD_KEYS.map(
    (key, i) => `m${i}: metafield(namespace: "sdl_3d", key: "${key}") { key type value }`,
  ).join("\n");

  const data = await adminGraphql<{
    product: Record<string, { key: string; type: string; value: string } | null> | null;
  }>(admin, `query($id:ID!){product(id:$id){${aliases}}}`, { id: productGid });

  if (!data.product) return [];

  const out: Array<Record<string, unknown>> = [];
  for (let i = 0; i < METAFIELD_KEYS.length; i++) {
    const mf = data.product[`m${i}`];
    if (mf) {
      out.push({
        ownerId: productGid,
        namespace: NAMESPACE,
        key: mf.key,
        type: mf.type,
        value: mf.value,
      });
    }
  }
  return out;
}

/**
 * Quick check whether the product already has SDL 3D metafields populated by
 * an external source (e.g. the sdl-platform pipeline). Used to auto-pull when
 * the hotspot app opens a product for the first time.
 */
export async function hasSyncableSdl3dMetafields(args: {
  admin: AdminGraphqlClient;
  shopifyProductGid: string;
}): Promise<boolean> {
  const { admin, shopifyProductGid } = args;

  const data = await adminGraphql<{
    product: {
      imageSequence: { value: string } | null;
      modelFile: { value: string } | null;
      viewerType: { value: string } | null;
    } | null;
  }>(
    admin,
    `
      query CheckSdl3dMetafields($id: ID!) {
        product(id: $id) {
          imageSequence: metafield(namespace: "sdl_3d", key: "image_sequence") { value }
          modelFile: metafield(namespace: "sdl_3d", key: "model_file") { value }
          viewerType: metafield(namespace: "sdl_3d", key: "viewer_type") { value }
        }
      }
    `,
    { id: shopifyProductGid },
  );

  if (!data.product) return false;

  if (data.product.modelFile?.value) return true;

  const imageSequenceValue = data.product.imageSequence?.value;
  if (imageSequenceValue) {
    try {
      const frames = JSON.parse(imageSequenceValue);
      if (Array.isArray(frames) && frames.length > 0) return true;
    } catch {
      // fall through
    }
  }

  return false;
}

export async function pullMetafieldsToDraft(args: {
  admin: AdminGraphqlClient;
  shopDomain: string;
  shopifyProductGid: string;
}) {
  const { admin, shopDomain, shopifyProductGid } = args;
  const shop = await ensureShop(shopDomain);

  const data = await adminGraphql<{
    product: {
      id: string;
      schemaVersion: { value: string } | null;
      enabled: { value: string } | null;
      mode: { value: string } | null;
      viewerType: { value: string } | null;
      modelFile: { value: string } | null;
      posterFile: { value: string } | null;
      viewerSettings: { value: string } | null;
      hotspots: { value: string } | null;
      imageSequence: { value: string } | null;
      hotspots360: { value: string } | null;
    } | null;
  }>(
    admin,
    `
      query PullSdl3dMetafields($id: ID!) {
        product(id: $id) {
          id
          schemaVersion: metafield(namespace: "sdl_3d", key: "schema_version") {
            value
          }
          enabled: metafield(namespace: "sdl_3d", key: "enabled") {
            value
          }
          mode: metafield(namespace: "sdl_3d", key: "mode") {
            value
          }
          viewerType: metafield(namespace: "sdl_3d", key: "viewer_type") {
            value
          }
          modelFile: metafield(namespace: "sdl_3d", key: "model_file") {
            value
          }
          posterFile: metafield(namespace: "sdl_3d", key: "poster_file") {
            value
          }
          viewerSettings: metafield(namespace: "sdl_3d", key: "viewer_settings") {
            value
          }
          hotspots: metafield(namespace: "sdl_3d", key: "hotspots") {
            value
          }
          imageSequence: metafield(namespace: "sdl_3d", key: "image_sequence") {
            value
          }
          hotspots360: metafield(namespace: "sdl_3d", key: "hotspots_360") {
            value
          }
        }
      }
    `,
    { id: shopifyProductGid },
  );

  if (!data.product) {
    throw new Error(`Product not found: ${shopifyProductGid}`);
  }

  // ── schema_version gate ──
  // A missing version means legacy data written before Phase 2 — accept it.
  // A version newer than the app supports means a future platform wrote this
  // product; the app should fall back rather than silently drop fields.
  const parseIssues: string[] = [];
  const rawSchemaVersion = data.product.schemaVersion?.value;
  if (rawSchemaVersion != null && rawSchemaVersion !== "") {
    const parsedVersion = Number(rawSchemaVersion);
    if (Number.isFinite(parsedVersion) && parsedVersion > SDL3D_SCHEMA_VERSION) {
      parseIssues.push(
        `sdl_3d.schema_version=${parsedVersion} is newer than app-supported version ${SDL3D_SCHEMA_VERSION}; some fields may be ignored`,
      );
    }
  }

  const enabled = data.product.enabled?.value === "true";
  const modeValue = data.product.mode?.value === "metafield" ? "metafield" : "app";

  // ── viewer_type: parse through shared Zod (strict lowercase) ──
  const rawViewerType = data.product.viewerType?.value ?? null;
  let viewerType: "MODEL_3D" | "IMAGE_360" = "MODEL_3D";
  if (rawViewerType != null) {
    const parsed = ViewerTypeSchema.safeParse(rawViewerType);
    if (parsed.success) {
      viewerType = viewerTypeWireToDb(parsed.data);
    } else {
      parseIssues.push(
        `sdl_3d.viewer_type="${rawViewerType}" failed validation; defaulting to model_3d. Legacy uppercase values must be migrated.`,
      );
    }
  }

  // ── viewer_settings: Zod safeParse with fallback to defaults ──
  const rawViewerSettingsJson = data.product.viewerSettings?.value ?? null;
  let viewerSettings = coerceViewerSettings(defaultViewerSettings);
  if (rawViewerSettingsJson) {
    try {
      const raw = JSON.parse(rawViewerSettingsJson);
      const parsed = ViewerSettingsSchema.safeParse(raw);
      if (parsed.success) {
        // Slice 8 PR #2: layer raw → parsed so the new
        // autoRotateSpeed / autoRotateDirection fields (not known
        // to the shared schema yet) survive metafield→DB sync.
        viewerSettings = {
          ...defaultViewerSettings,
          ...(typeof raw === "object" && raw !== null ? raw : {}),
          ...parsed.data,
        } as typeof defaultViewerSettings;
      } else {
        parseIssues.push(
          `sdl_3d.viewer_settings failed validation: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`,
        );
        // Merge raw into defaults so a single bad field doesn't nuke the whole object
        viewerSettings = coerceViewerSettings(raw);
      }
    } catch (err) {
      parseIssues.push(`sdl_3d.viewer_settings JSON parse failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ── hotspots: Zod safeParse with fallback to [] ──
  const rawHotspotsJson = data.product.hotspots?.value ?? null;
  let hotspots: PublishedHotspot[] = [];
  if (rawHotspotsJson) {
    try {
      const raw = JSON.parse(rawHotspotsJson);
      const parsed = HotspotsArraySchema.safeParse(raw);
      if (parsed.success) {
        hotspots = parsed.data as unknown as PublishedHotspot[];
      } else {
        parseIssues.push(
          `sdl_3d.hotspots failed validation: ${parsed.error.issues.map((i) => `[${i.path.join(".")}] ${i.message}`).join("; ")}`,
        );
      }
    } catch (err) {
      parseIssues.push(`sdl_3d.hotspots JSON parse failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ── image_sequence: validate; drop entirely if invalid (storefront will fall back) ──
  let imageSequenceJson: string | null = data.product.imageSequence?.value ?? null;
  let imageSequenceFrames: unknown[] = [];
  if (imageSequenceJson) {
    try {
      const raw = JSON.parse(imageSequenceJson);
      const parsed = ImageSequenceSchema.safeParse(raw);
      if (parsed.success) {
        imageSequenceFrames = parsed.data;
        imageSequenceJson = JSON.stringify(parsed.data);
      } else {
        parseIssues.push(
          `sdl_3d.image_sequence failed validation: ${parsed.error.issues.map((i) => `[${i.path.join(".")}] ${i.message}`).join("; ")}`,
        );
        imageSequenceJson = null;
      }
    } catch (err) {
      parseIssues.push(`sdl_3d.image_sequence JSON parse failed: ${err instanceof Error ? err.message : String(err)}`);
      imageSequenceJson = null;
    }
  }

  // ── hotspots_360: validate; drop entirely if invalid ──
  let hotspotsJson360: string | null = data.product.hotspots360?.value ?? null;
  if (hotspotsJson360) {
    try {
      const raw = JSON.parse(hotspotsJson360);
      const parsed = Hotspots360ArraySchema.safeParse(raw);
      if (parsed.success) {
        hotspotsJson360 = JSON.stringify(parsed.data);
      } else {
        parseIssues.push(
          `sdl_3d.hotspots_360 failed validation: ${parsed.error.issues.map((i) => `[${i.path.join(".")}] ${i.message}`).join("; ")}`,
        );
        hotspotsJson360 = null;
      }
    } catch (err) {
      parseIssues.push(`sdl_3d.hotspots_360 JSON parse failed: ${err instanceof Error ? err.message : String(err)}`);
      hotspotsJson360 = null;
    }
  }

  // Wrap all DB writes in a transaction so it's all-or-nothing
  const productConfig = await prisma.$transaction(async (tx) => {
    const pc = await tx.productConfig.upsert({
      where: {
        shopId_shopifyProductGid: {
          shopId: shop.id,
          shopifyProductGid,
        },
      },
      update: {
        enabled,
        sourceMode: modeValue === "metafield" ? "METAFIELD" : "APP",
        status: "DRAFT",
        viewerType,
        modelFileShopifyGid: data.product!.modelFile?.value ?? null,
        posterFileShopifyGid: data.product!.posterFile?.value ?? null,
        viewerSettingsJson: JSON.stringify(viewerSettings),
        imageSequenceJson: imageSequenceJson,
        frameCount: imageSequenceFrames.length,
        hotspotsJson360: hotspotsJson360,
      },
      create: {
        shopId: shop.id,
        shopifyProductGid,
        enabled,
        sourceMode: modeValue === "metafield" ? "METAFIELD" : "APP",
        status: "DRAFT",
        viewerType,
        modelFileShopifyGid: data.product!.modelFile?.value ?? null,
        posterFileShopifyGid: data.product!.posterFile?.value ?? null,
        viewerSettingsJson: JSON.stringify(viewerSettings),
        imageSequenceJson: imageSequenceJson,
        frameCount: imageSequenceFrames.length,
        hotspotsJson360: hotspotsJson360,
      },
    });

    await tx.hotspot.deleteMany({
      where: { productConfigId: pc.id },
    });

    if (hotspots.length) {
      await tx.hotspot.createMany({
        data: publishedHotspotsToCreateMany(pc.id, hotspots),
      });
    }

    await tx.syncRun.create({
      data: {
        shopId: shop.id,
        shopifyProductGid,
        direction: "METAFIELD_TO_DB",
        status: parseIssues.length > 0 ? "FAILED" : "SUCCESS",
        message:
          parseIssues.length > 0
            ? `Pulled SDL 3D metafields with ${parseIssues.length} validation issue(s): ${parseIssues.join(" | ")}`
            : "Pulled SDL 3D metafields into draft config.",
      },
    });

    return pc;
  });

  return { ok: true, productConfigId: productConfig.id, parseIssues };
}
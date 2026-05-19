/**
 * Slice 3 — "Upload raw captures" affordance for the editor.
 * UI migrated to Polaris in Slice 5C PR #5h (2026-05-19).
 *
 * Flow:
 *   1. Pick files (single .zip OR a folder's worth of images we'll zip in the
 *      browser via JSZip).
 *   2. POST signRawUpload → server creates a PENDING Capture row + signed PUT
 *      URL. We hold onto captureId locally.
 *   3. PUT the zip directly to the bucket via the signed URL (web tier never
 *      sees raw bytes; this is the merchant's bucket).
 *   4. POST recordRawUpload → server flips QUEUED + enqueues process_capture.
 *   5. Poll GET ?captureId=... every 2s until status terminal.
 *   6. On COMPLETED, call `onCompleted` so the editor revalidates and the new
 *      frames appear in the inspector.
 *
 * No `.server` imports — this file is reachable from the route's JSX.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Banner,
  BlockStack,
  Button,
  Card,
  InlineStack,
  ProgressBar,
  Spinner,
  Text,
} from "@shopify/polaris";
import type { CaptureStatus } from "../lib/captures-shared";

const POLL_INTERVAL_MS = 2000;
const POLL_MAX_DURATION_MS = 1000 * 60 * 15; // 15 minutes hard stop

type SignResponse = {
  ok: boolean;
  message?: string;
  captureId?: string;
  uploadUrl?: string;
  uploadMethod?: string;
  uploadContentType?: string;
  needsStorageSetup?: boolean;
};

type StatusResponse = {
  ok: boolean;
  message?: string;
  capture?: {
    id: string;
    status: CaptureStatus;
    errorMessage: string | null;
    frameCountActual: number | null;
    frameCountTarget: number;
  } | null;
};

type LocalState =
  | { kind: "idle" }
  | { kind: "zipping"; processed: number; total: number }
  | { kind: "signing" }
  | { kind: "uploading"; captureId: string; loaded: number; total: number }
  | { kind: "recording"; captureId: string }
  | {
      kind: "processing";
      captureId: string;
      status: CaptureStatus;
      frameCountTarget: number;
    }
  | { kind: "done"; captureId: string; frameCount: number }
  | {
      kind: "error";
      message: string;
      captureId?: string;
      needsStorageSetup?: boolean;
      retryable: boolean;
    };

type Props = {
  productGid: string;
  productConfigId: string;
  /** Called once a capture lands in COMPLETED so the parent can revalidate. */
  onCompleted: () => void;
  /** Optional path/link target for the storage settings page. */
  storageSettingsHref?: string;
  /**
   * Optional storage row id override. When set, the capture uploads to this
   * specific bucket instead of the shop's default. Editor-state only —
   * never persisted across reloads. Slice 6 PR #3.
   */
  storageId?: string;
  /** Optional initial capture state (e.g. an in-flight job from a previous session). */
  initialCapture?: {
    id: string;
    status: CaptureStatus;
    errorMessage: string | null;
    frameCountActual: number | null;
    frameCountTarget: number;
  } | null;
};

const ZIP_TYPE_RE = /\.zip$/i;
const IMAGE_EXT_RE = /\.(jpe?g|png|webp|tiff?|bmp)$/i;

async function buildZip(
  files: File[],
  onProgress: (processed: number, total: number) => void,
): Promise<{ blob: Blob; sizeBytes: number }> {
  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    zip.file(f.name, f);
    onProgress(i + 1, files.length);
  }
  const blob = await zip.generateAsync({ type: "blob", compression: "STORE" });
  return { blob, sizeBytes: blob.size };
}

function uploadWithProgress(
  url: string,
  method: string,
  contentType: string,
  body: Blob,
  onProgress: (loaded: number, total: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, url);
    xhr.setRequestHeader("Content-Type", contentType);
    xhr.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) onProgress(event.loaded, event.total);
    });
    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        reject(new Error(`Bucket upload failed: HTTP ${xhr.status} ${xhr.statusText || xhr.responseText.slice(0, 200)}`));
      }
    });
    xhr.addEventListener("error", () => reject(new Error("Network error during bucket upload.")));
    xhr.addEventListener("abort", () => reject(new Error("Bucket upload aborted.")));
    xhr.send(body);
  });
}

export function Sdl3dRawCaptureUploader({
  productGid,
  productConfigId,
  onCompleted,
  storageSettingsHref = "/app/sdl3d/storage",
  storageId,
  initialCapture = null,
}: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const completedFiredRef = useRef(false);

  const [state, setState] = useState<LocalState>(() => {
    if (!initialCapture) return { kind: "idle" };

    // QUEUED or PROCESSING means the worker either has the job or will soon —
    // start polling and show progress immediately.
    if (initialCapture.status === "QUEUED" || initialCapture.status === "PROCESSING") {
      return {
        kind: "processing",
        captureId: initialCapture.id,
        status: initialCapture.status,
        frameCountTarget: initialCapture.frameCountTarget,
      };
    }

    if (initialCapture.status === "FAILED") {
      return {
        kind: "error",
        message: initialCapture.errorMessage ?? "Last capture failed.",
        captureId: initialCapture.id,
        retryable: true,
      };
    }

    // PENDING / UPLOADING — signRawUpload ran but recordRawUpload never did,
    // which means the upload was abandoned (tab closed, network died, etc.).
    // Don't pretend the worker is doing anything; let the merchant start over.
    // The orphan row stays in the DB until the next capture or a manual cleanup
    // overwrites it.
    return { kind: "idle" };
  });

  // Polling loop while we're in the "processing" state.
  useEffect(() => {
    if (state.kind !== "processing") return;
    let cancelled = false;
    const startedAt = Date.now();
    const captureId = state.captureId;

    async function poll() {
      try {
        const res = await fetch(
          `/api/sdl3d/captures?captureId=${encodeURIComponent(captureId)}`,
          { credentials: "include" },
        );
        const data = (await res.json()) as StatusResponse;
        if (cancelled) return;
        if (!data.ok || !data.capture) {
          setState({
            kind: "error",
            message: data.message ?? "Lost track of capture.",
            captureId,
            retryable: true,
          });
          return;
        }
        const cap = data.capture;
        if (cap.status === "COMPLETED") {
          setState({
            kind: "done",
            captureId,
            frameCount: cap.frameCountActual ?? cap.frameCountTarget,
          });
          return;
        }
        if (cap.status === "FAILED") {
          setState({
            kind: "error",
            message: cap.errorMessage ?? "Capture processing failed.",
            captureId,
            needsStorageSetup: /storage|credentials|bucket|head ?bucket/i.test(
              cap.errorMessage ?? "",
            ),
            retryable: true,
          });
          return;
        }
        setState((prev) =>
          prev.kind === "processing"
            ? { ...prev, status: cap.status }
            : prev,
        );

        if (Date.now() - startedAt > POLL_MAX_DURATION_MS) {
          setState({
            kind: "error",
            message:
              "Capture is taking longer than expected (15+ minutes). The worker may be stuck — check container logs or retry.",
            captureId,
            retryable: true,
          });
          return;
        }
        setTimeout(poll, POLL_INTERVAL_MS);
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : "Polling failed.";
        setState({
          kind: "error",
          message,
          captureId,
          retryable: true,
        });
      }
    }

    const timer = setTimeout(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [state.kind, state.kind === "processing" ? state.captureId : null]);

  // Fire onCompleted once when we transition to done.
  useEffect(() => {
    if (state.kind === "done" && !completedFiredRef.current) {
      completedFiredRef.current = true;
      onCompleted();
    }
    if (state.kind !== "done") {
      completedFiredRef.current = false;
    }
  }, [state.kind, onCompleted]);

  const handleFileChange = useCallback(
    async (eventFiles: FileList) => {
      const files = Array.from(eventFiles);
      if (!files.length) return;

      try {
        let zipBlob: Blob;
        let sizeBytes: number;

        if (files.length === 1 && ZIP_TYPE_RE.test(files[0].name)) {
          zipBlob = files[0];
          sizeBytes = files[0].size;
        } else {
          const images = files.filter((f) => IMAGE_EXT_RE.test(f.name));
          if (images.length === 0) {
            setState({
              kind: "error",
              message:
                "No supported image files in selection. Pick a .zip or a folder of .jpg/.png/.webp images.",
              retryable: false,
            });
            return;
          }
          setState({ kind: "zipping", processed: 0, total: images.length });
          const result = await buildZip(images, (processed, total) =>
            setState({ kind: "zipping", processed, total }),
          );
          zipBlob = result.blob;
          sizeBytes = result.sizeBytes;
        }

        setState({ kind: "signing" });
        const signForm = new FormData();
        signForm.set("intent", "signRawUpload");
        signForm.set("productGid", productGid);
        signForm.set("productConfigId", productConfigId);
        signForm.set("rawSizeBytes", String(sizeBytes));
        if (storageId) signForm.set("storageId", storageId);
        const signRes = await fetch("/api/sdl3d/captures", {
          method: "POST",
          body: signForm,
          credentials: "include",
        });
        const signed = (await signRes.json()) as SignResponse;
        if (!signed.ok || !signed.captureId || !signed.uploadUrl) {
          setState({
            kind: "error",
            message: signed.message ?? "Could not sign upload URL.",
            needsStorageSetup: signed.needsStorageSetup,
            retryable: false,
          });
          return;
        }

        setState({
          kind: "uploading",
          captureId: signed.captureId,
          loaded: 0,
          total: sizeBytes,
        });
        await uploadWithProgress(
          signed.uploadUrl,
          signed.uploadMethod ?? "PUT",
          signed.uploadContentType ?? "application/zip",
          zipBlob,
          (loaded, total) =>
            setState({
              kind: "uploading",
              captureId: signed.captureId!,
              loaded,
              total,
            }),
        );

        setState({ kind: "recording", captureId: signed.captureId });
        const recordForm = new FormData();
        recordForm.set("intent", "recordRawUpload");
        recordForm.set("captureId", signed.captureId);
        recordForm.set("rawSizeBytes", String(sizeBytes));
        const recordRes = await fetch("/api/sdl3d/captures", {
          method: "POST",
          body: recordForm,
          credentials: "include",
        });
        const recorded = (await recordRes.json()) as StatusResponse;
        if (!recorded.ok || !recorded.capture) {
          setState({
            kind: "error",
            message: recorded.message ?? "Could not enqueue processing job.",
            captureId: signed.captureId,
            retryable: true,
          });
          return;
        }

        setState({
          kind: "processing",
          captureId: signed.captureId,
          status: recorded.capture.status,
          frameCountTarget: recorded.capture.frameCountTarget,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Upload failed.";
        setState({ kind: "error", message, retryable: true });
      } finally {
        if (inputRef.current) inputRef.current.value = "";
      }
    },
    [productGid, productConfigId],
  );

  const handleRetry = useCallback(async () => {
    if (state.kind !== "error" || !state.captureId) {
      setState({ kind: "idle" });
      return;
    }
    const captureId = state.captureId;
    setState({ kind: "recording", captureId });
    try {
      const fd = new FormData();
      fd.set("intent", "retry");
      fd.set("captureId", captureId);
      const res = await fetch("/api/sdl3d/captures", {
        method: "POST",
        body: fd,
        credentials: "include",
      });
      const data = (await res.json()) as StatusResponse;
      if (!data.ok || !data.capture) {
        setState({
          kind: "error",
          message: data.message ?? "Retry failed.",
          captureId,
          retryable: false,
        });
        return;
      }
      setState({
        kind: "processing",
        captureId,
        status: data.capture.status,
        frameCountTarget: data.capture.frameCountTarget,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Retry failed.";
      setState({ kind: "error", message, captureId, retryable: false });
    }
  }, [state]);

  const isWorking =
    state.kind === "zipping" ||
    state.kind === "signing" ||
    state.kind === "uploading" ||
    state.kind === "recording" ||
    state.kind === "processing";

  const uploadProgressPct =
    state.kind === "uploading" && state.total > 0
      ? Math.round((state.loaded / state.total) * 100)
      : null;

  return (
    <Card>
      <BlockStack gap="200">
        <Text as="h3" variant="headingSm">
          Raw captures (auto-process)
        </Text>
        <Text as="p" tone="subdued" variant="bodySm">
          Upload a folder of raw turntable photos (or a .zip). The worker
          samples them to 72 frames, converts to WebP, and writes the
          resulting sequence to your bucket. Your bucket — never SDL&apos;s.
        </Text>

        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".zip,image/jpeg,image/png,image/webp,image/tiff,image/bmp"
          style={{ display: "none" }}
          onChange={(e) => {
            if (e.target.files) handleFileChange(e.target.files);
          }}
        />

        <InlineStack>
          <Button
            variant="primary"
            disabled={isWorking}
            loading={isWorking && state.kind !== "processing"}
            onClick={() => inputRef.current?.click()}
          >
            {isWorking ? "Working…" : "Upload raw captures"}
          </Button>
        </InlineStack>

        {state.kind === "zipping" ? (
          <BlockStack gap="100">
            <InlineStack gap="200" blockAlign="center">
              <Spinner size="small" accessibilityLabel="Zipping files" />
              <Text as="span" variant="bodySm" tone="subdued">
                {`Zipping… ${state.processed}/${state.total}`}
              </Text>
            </InlineStack>
            <ProgressBar
              size="small"
              progress={state.total > 0 ? Math.round((state.processed / state.total) * 100) : 0}
            />
          </BlockStack>
        ) : null}

        {state.kind === "signing" ? (
          <InlineStack gap="200" blockAlign="center">
            <Spinner size="small" accessibilityLabel="Requesting signed URL" />
            <Text as="span" variant="bodySm" tone="subdued">
              Requesting signed upload URL…
            </Text>
          </InlineStack>
        ) : null}

        {state.kind === "uploading" ? (
          <BlockStack gap="100">
            <Text as="span" variant="bodySm" tone="subdued">
              {uploadProgressPct !== null
                ? `Uploading to your bucket… ${uploadProgressPct}%`
                : "Uploading to your bucket…"}
            </Text>
            <ProgressBar size="small" progress={uploadProgressPct ?? 0} />
          </BlockStack>
        ) : null}

        {state.kind === "recording" ? (
          <InlineStack gap="200" blockAlign="center">
            <Spinner size="small" accessibilityLabel="Enqueueing processing job" />
            <Text as="span" variant="bodySm" tone="subdued">
              Enqueueing processing job…
            </Text>
          </InlineStack>
        ) : null}

        {state.kind === "processing" ? (
          <Banner tone="info">
            <InlineStack gap="200" blockAlign="center">
              <Spinner size="small" accessibilityLabel="Processing on worker" />
              <Text as="span" variant="bodySm">
                {`Processing on the worker (status: ${state.status.toLowerCase()})… target ${state.frameCountTarget} frames. Safe to leave this page; the job runs server-side.`}
              </Text>
            </InlineStack>
          </Banner>
        ) : null}

        {state.kind === "done" ? (
          <Banner tone="success" title="Capture processed">
            <Text as="p" variant="bodySm">
              {`${state.frameCount} frames live. The viewer should refresh below in a moment.`}
            </Text>
          </Banner>
        ) : null}

        {state.kind === "error" ? (
          <Banner
            tone="critical"
            title="Capture failed"
            action={
              state.needsStorageSetup
                ? { content: "Open Storage settings", url: storageSettingsHref }
                : state.retryable && state.captureId
                  ? { content: "Retry", onAction: handleRetry }
                  : undefined
            }
            secondaryAction={{
              content: "Dismiss",
              onAction: () => setState({ kind: "idle" }),
            }}
          >
            <Text as="p" variant="bodySm">
              {state.message}
            </Text>
          </Banner>
        ) : null}
      </BlockStack>
    </Card>
  );
}

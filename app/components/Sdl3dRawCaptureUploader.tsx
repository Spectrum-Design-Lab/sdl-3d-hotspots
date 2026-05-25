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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Banner,
  BlockStack,
  Button,
  Card,
  InlineStack,
  List,
  ProgressBar,
  Spinner,
  Text,
  TextField,
} from "@shopify/polaris";
import type { ValidationIssue, ValidationReport } from "@spectrum-design-lab/shared";
import {
  type CaptureStatus,
  DEFAULT_FRAME_COUNT_TARGET,
  FOLDER_NAME_MAX_LENGTH,
  slugifyFolderName,
} from "../lib/captures-shared";
import {
  parseFilenamesForFrames,
  validateCaptureFrames,
} from "../lib/capture-pipeline/validator";

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
    /** Slice 9 PR #1 — serialized `ValidationReport`; null when clean. */
    validationJson: string | null;
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
  | {
      kind: "done";
      captureId: string;
      frameCount: number;
      validationJson: string | null;
    }
  | {
      kind: "cancelled";
      captureId: string;
    }
  | {
      kind: "error";
      message: string;
      captureId?: string;
      needsStorageSetup?: boolean;
      retryable: boolean;
      validationJson: string | null;
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
  /**
   * When true, render the body without the outer Card + heading wrapper so
   * the component can be embedded inside another container (e.g. the
   * unified Sdl3dMediaSourceModal's Upload tab in Slice 7 PR #3b).
   */
  embedded?: boolean;
  /** Optional initial capture state (e.g. an in-flight job from a previous session). */
  initialCapture?: {
    id: string;
    status: CaptureStatus;
    errorMessage: string | null;
    frameCountActual: number | null;
    frameCountTarget: number;
    /** Slice 9 PR #1 — last-known validation report, restored on reload. */
    validationJson?: string | null;
  } | null;
};

const ZIP_TYPE_RE = /\.zip$/i;
const IMAGE_EXT_RE = /\.(jpe?g|png|webp|tiff?|bmp)$/i;

const ISSUE_PREVIEW_LIMIT = 8;

function formatIssue(issue: ValidationIssue): string {
  if (issue.filename) return `${issue.filename}: ${issue.message}`;
  if (issue.frameIndex !== undefined) return `Frame ${issue.frameIndex}: ${issue.message}`;
  return issue.message;
}

function ValidationIssueList({ report }: { report: ValidationReport }) {
  const shown = report.issues.slice(0, ISSUE_PREVIEW_LIMIT);
  const overflow = report.issues.length - shown.length;
  return (
    <BlockStack gap="100">
      <List type="bullet">
        {shown.map((issue, idx) => (
          <List.Item key={`${issue.type}-${idx}`}>{formatIssue(issue)}</List.Item>
        ))}
      </List>
      {overflow > 0 ? (
        <Text as="p" variant="bodySm" tone="subdued">
          {`…and ${overflow} more issue${overflow === 1 ? "" : "s"} not shown.`}
        </Text>
      ) : null}
    </BlockStack>
  );
}

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
  embedded = false,
  initialCapture = null,
}: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  // Separate folder-picker input so the merchant can drop a whole capture
  // directory in one click on browsers that support `webkitdirectory`
  // (Chrome/Edge/Firefox/Safari — broadly supported in practice). The
  // existing inputRef stays for individual files + .zip selection.
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const completedFiredRef = useRef(false);

  // Slice 9 polish — merchant-supplied bucket folder name (optional).
  // The server slugifies authoritatively; we slugify here too for live
  // preview so the merchant sees the actual key segment they're about
  // to commit to (no surprise "MyProduct → my-product" on submit).
  const [folderNameInput, setFolderNameInput] = useState("");
  const folderNamePreview = useMemo(
    () => slugifyFolderName(folderNameInput),
    [folderNameInput],
  );

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
        validationJson: initialCapture.validationJson ?? null,
      };
    }

    if (initialCapture.status === "CANCELLED") {
      return { kind: "cancelled", captureId: initialCapture.id };
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
            validationJson: null,
          });
          return;
        }
        const cap = data.capture;
        if (cap.status === "COMPLETED") {
          setState({
            kind: "done",
            captureId,
            frameCount: cap.frameCountActual ?? cap.frameCountTarget,
            validationJson: cap.validationJson,
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
            validationJson: cap.validationJson,
          });
          return;
        }
        if (cap.status === "CANCELLED") {
          setState({ kind: "cancelled", captureId });
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
            validationJson: null,
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
          validationJson: null,
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

        // Slice 9 polish — client-side pre-flight. Runs before any zipping
        // or bucket-touching so a bad capture (wrong filenames, too few
        // frames) is rejected in milliseconds and never lands a `raw.zip`
        // on the merchant's CDN. Server-side validator still runs as
        // defense-in-depth for cases the browser can't predict
        // (e.g. mid-flight corruption).
        let preflightFilenames: string[];
        if (files.length === 1 && ZIP_TYPE_RE.test(files[0].name)) {
          // Peek into the zip's central directory without unpacking it.
          // For the zip path we read the file's metadata once here, then
          // hand the original Blob to the uploader untouched.
          try {
            const JSZip = (await import("jszip")).default;
            const peek = await JSZip.loadAsync(files[0]);
            preflightFilenames = Object.entries(peek.files)
              .filter(([, entry]) => !entry.dir)
              .map(([relPath]) => {
                // Strip macOS metadata noise the orchestrator's extractZip
                // also drops, so pre-flight counts match the worker's.
                if (relPath.includes("__MACOSX")) return "";
                const base = relPath.split("/").pop() ?? relPath;
                if (base.startsWith("._")) return "";
                return base;
              })
              .filter((name) => name.length > 0);
          } catch (err) {
            const message =
              err instanceof Error ? err.message : "Could not read zip file.";
            setState({
              kind: "error",
              message: `Couldn't read the zip file: ${message}. Try re-exporting the archive.`,
              retryable: false,
              validationJson: null,
            });
            return;
          }
        } else {
          preflightFilenames = files
            .filter((f) => IMAGE_EXT_RE.test(f.name))
            .map((f) => f.name);
          if (preflightFilenames.length === 0) {
            setState({
              kind: "error",
              message:
                "No supported image files in selection. Pick a .zip or a folder of .jpg/.png/.webp images.",
              retryable: false,
              validationJson: null,
            });
            return;
          }
        }

        const parsed = parseFilenamesForFrames(preflightFilenames);
        const preflight = validateCaptureFrames("capture", parsed.frames, {
          selectedCount: DEFAULT_FRAME_COUNT_TARGET,
          skippedFilenames: parsed.skipped,
        });
        if (preflight.hardFail) {
          setState({
            kind: "error",
            message:
              preflight.summary ??
              "These frames can't be processed. Adjust your capture and try again.",
            retryable: false,
            validationJson: JSON.stringify(preflight.report),
          });
          return;
        }

        if (files.length === 1 && ZIP_TYPE_RE.test(files[0].name)) {
          zipBlob = files[0];
          sizeBytes = files[0].size;
        } else {
          const images = files.filter((f) => IMAGE_EXT_RE.test(f.name));
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
        // Slice 9 polish — optional folder name. Server re-slugifies and
        // enforces shop-scoped uniqueness; sending the raw input is fine.
        if (folderNameInput.trim()) signForm.set("folderName", folderNameInput);
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
            validationJson: null,
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
            validationJson: null,
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
        setState({
          kind: "error",
          message,
          retryable: true,
          validationJson: null,
        });
      } finally {
        if (inputRef.current) inputRef.current.value = "";
        if (folderInputRef.current) folderInputRef.current.value = "";
      }
    },
    [productGid, productConfigId, storageId, folderNameInput],
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
          validationJson: null,
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
      setState({
        kind: "error",
        message,
        captureId,
        retryable: false,
        validationJson: null,
      });
    }
  }, [state]);

  // Slice 9 PR #3 — cancel an in-flight capture. Only meaningful after a
  // captureId exists on the row (uploading / recording / processing); the
  // pre-capture zip phase is a pure client operation the merchant can
  // already abort by clicking away. PENDING/UPLOADING/QUEUED captures
  // are flipped to CANCELLED immediately by the API; PROCESSING captures
  // wait for the orchestrator's next isCancelled check between steps.
  const handleCancel = useCallback(async () => {
    if (state.kind !== "uploading" && state.kind !== "recording" && state.kind !== "processing") {
      return;
    }
    const captureId = state.captureId;
    try {
      const fd = new FormData();
      fd.set("intent", "cancel");
      fd.set("captureId", captureId);
      await fetch("/api/sdl3d/captures", {
        method: "POST",
        body: fd,
        credentials: "include",
      });
      // Reflect optimistically — the poller will catch up if PROCESSING
      // needs the orchestrator to finalise. Once the worker writes
      // CANCELLED the polling effect picks it up too.
      setState({ kind: "cancelled", captureId });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Cancel failed.";
      setState({
        kind: "error",
        message,
        captureId,
        retryable: true,
        validationJson: null,
      });
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

  // Parse the validation report only when we have something to show. The
  // worker writes a string-encoded `ValidationReport`; bad JSON is treated
  // as "no report" rather than crashing the panel.
  const validationReport = useMemo<ValidationReport | null>(() => {
    const json =
      state.kind === "done" || state.kind === "error"
        ? state.validationJson
        : null;
    if (!json) return null;
    try {
      return JSON.parse(json) as ValidationReport;
    } catch {
      return null;
    }
  }, [state]);

  const body = (
    <BlockStack gap="200">
      {!embedded ? (
        <>
          <Text as="h3" variant="headingSm">
            Raw captures (auto-process)
          </Text>
          <Text as="p" tone="subdued" variant="bodySm">
            Upload a folder of raw turntable photos (or a .zip). The worker
            samples them to 72 frames, converts to WebP, and writes the
            resulting sequence to your bucket. Your bucket — never SDL&apos;s.
          </Text>
        </>
      ) : null}

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
        {/*
          webkitdirectory + directory: lets the merchant select a whole
          folder. `directory` is the standards-track name; `webkitdirectory`
          is the de-facto cross-browser one. We mark both via JSX-cast
          because the React DOM types don't yet include the standard
          `directory` attribute. Files arriving here have webkit-relative
          paths but `handleFileChange` only needs name + size, so the
          same handler works for both inputs.
        */}
        <input
          ref={folderInputRef}
          type="file"
          multiple
          // @ts-expect-error — webkitdirectory not in HTMLInputElement TS types
          webkitdirectory=""
          directory=""
          style={{ display: "none" }}
          onChange={(e) => {
            if (e.target.files) handleFileChange(e.target.files);
          }}
        />

        {/*
          Slice 9 polish — hide the picker buttons entirely while work is
          in flight. Without this we end up with two simultaneous loading
          indicators (the buttons' spinners + the progress section below)
          which reads as "broken / stuck" rather than "one thing in
          progress." Showing only the progress section turns the Card
          into a focused status surface.
        */}
        {!isWorking ? (
          <BlockStack gap="200">
            {/* Slice 9 polish — optional bucket folder name. Live slug
                preview keeps the merchant from guessing how the input
                gets normalized; collisions are caught server-side on
                submit. */}
            <TextField
              label="Folder name (optional)"
              value={folderNameInput}
              onChange={setFolderNameInput}
              maxLength={FOLDER_NAME_MAX_LENGTH}
              autoComplete="off"
              placeholder="e.g. PRD-0042 or sneaker-prototype-v3"
              helpText={
                folderNamePreview
                  ? `Bucket path will be …/captures/${folderNamePreview}/`
                  : "Leave blank to use an auto-generated ID. Letters, digits, hyphens, and underscores only."
              }
            />
            <InlineStack gap="200">
              <Button
                variant="primary"
                onClick={() => inputRef.current?.click()}
              >
                Upload files or .zip
              </Button>
              <Button onClick={() => folderInputRef.current?.click()}>
                Upload folder
              </Button>
            </InlineStack>
          </BlockStack>
        ) : null}

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
            <InlineStack align="space-between" blockAlign="center">
              <Text as="span" variant="bodySm" tone="subdued">
                {uploadProgressPct !== null
                  ? `Uploading to your bucket… ${uploadProgressPct}%`
                  : "Uploading to your bucket…"}
              </Text>
              <Button variant="plain" tone="critical" onClick={handleCancel}>
                Cancel
              </Button>
            </InlineStack>
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
          <Banner
            tone="info"
            action={{ content: "Cancel", onAction: handleCancel }}
          >
            <InlineStack gap="200" blockAlign="center">
              <Spinner size="small" accessibilityLabel="Processing on worker" />
              <Text as="span" variant="bodySm">
                {`Processing on the worker (status: ${state.status.toLowerCase()})… target ${state.frameCountTarget} frames. Safe to leave this page; the job runs server-side.`}
              </Text>
            </InlineStack>
          </Banner>
        ) : null}

        {state.kind === "cancelled" ? (
          <Banner
            tone="warning"
            title="Capture cancelled"
            secondaryAction={{
              content: "Dismiss",
              onAction: () => setState({ kind: "idle" }),
            }}
          >
            <Text as="p" variant="bodySm">
              The capture was cancelled. The worker will skip any remaining
              steps and clean up. You can upload a fresh batch any time.
            </Text>
          </Banner>
        ) : null}

        {state.kind === "done" ? (
          <Banner tone="success" title="Capture processed">
            <BlockStack gap="200">
              <Text as="p" variant="bodySm">
                {`${state.frameCount} frames live. The viewer should refresh below in a moment.`}
              </Text>
              {validationReport && validationReport.issues.length > 0 ? (
                <>
                  <Text as="p" variant="bodySm" tone="subdued">
                    Some input frames needed fixing up — the pipeline handled them, but you may want to clean up your source folder before the next capture:
                  </Text>
                  <ValidationIssueList report={validationReport} />
                </>
              ) : null}
            </BlockStack>
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
            <BlockStack gap="200">
              <Text as="p" variant="bodySm">
                {state.message}
              </Text>
              {validationReport && validationReport.issues.length > 0 ? (
                <>
                  <Text as="p" variant="bodySm" tone="subdued">
                    Validation found these issues with the input frames:
                  </Text>
                  <ValidationIssueList report={validationReport} />
                </>
              ) : null}
            </BlockStack>
          </Banner>
        ) : null}
    </BlockStack>
  );

  return embedded ? body : <Card>{body}</Card>;
}

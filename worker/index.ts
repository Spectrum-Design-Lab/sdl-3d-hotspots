/**
 * Worker entrypoint. Runs as its own Node process alongside the web tier
 * (see scripts/start.sh). Boots pg-boss, registers job handlers, and waits
 * forever — pg-boss handles polling/dispatch internally.
 *
 * Slice 2: scaffolding only. The `processCapture` handler is wired but its
 * implementation is a stub until Slice 3 lands the Capture model + API.
 */

// Sentry init must be the first import — same rule as the web tier
// (entry.server.tsx). Side-effect import.
import "../app/lib/sentry.server";

import {
  JOB_NAMES,
  registerWorker,
  stopBoss,
  type QueueJob,
} from "../app/lib/queue.server";
import {
  runProcessCaptureJob,
  type ProcessCaptureJobData,
} from "../app/lib/capture-pipeline/orchestrator";
import { captureException, flushSentry } from "../app/lib/sentry.server";

const WORKER_NAME = "sdl-3d-hotspots-worker";

async function handleProcessCapture(
  job: QueueJob<ProcessCaptureJobData>,
): Promise<void> {
  const startedAt = Date.now();
  console.log(
    `[${WORKER_NAME}] picked up ${JOB_NAMES.PROCESS_CAPTURE} job ${job.id}`,
  );
  try {
    await runProcessCaptureJob(job.data);
    console.log(
      `[${WORKER_NAME}] completed job ${job.id} in ${Date.now() - startedAt}ms`,
    );
  } catch (err) {
    // The orchestrator catches its own pipeline errors and routes them
    // to Capture.status=FAILED + Sentry — anything escaping to this
    // outer catch is a queue/handler-level failure (e.g. shopify
    // auth boot crashed). Still worth reporting so we get visibility
    // into "worker crashed mid-job, pg-boss will retry."
    captureException(err, {
      scope: "worker",
      tags: { job: JOB_NAMES.PROCESS_CAPTURE },
      extra: { jobId: job.id, durationMs: Date.now() - startedAt },
    });
    console.error(`[${WORKER_NAME}] job ${job.id} failed:`, err);
    throw err;
  }
}

async function main() {
  console.log(`[${WORKER_NAME}] booting…`);
  await registerWorker<ProcessCaptureJobData>(
    JOB_NAMES.PROCESS_CAPTURE,
    handleProcessCapture,
  );
  console.log(
    `[${WORKER_NAME}] ready — listening for "${JOB_NAMES.PROCESS_CAPTURE}" jobs`,
  );
}

async function shutdown(signal: string): Promise<void> {
  console.log(`[${WORKER_NAME}] received ${signal}, draining pg-boss…`);
  try {
    await stopBoss();
  } catch (err) {
    console.error(`[${WORKER_NAME}] error during shutdown:`, err);
  }
  // Give Sentry a few seconds to flush any in-flight events before the
  // process exits — otherwise the very last error (often the one that
  // caused the shutdown) can be lost.
  await flushSentry(3000);
  process.exit(0);
}

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});
process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});
process.on("unhandledRejection", (reason) => {
  captureException(reason, { scope: "worker", tags: { kind: "unhandledRejection" } });
  console.error(`[${WORKER_NAME}] unhandledRejection:`, reason);
});

main().catch((err) => {
  console.error(`[${WORKER_NAME}] fatal boot error:`, err);
  process.exit(1);
});

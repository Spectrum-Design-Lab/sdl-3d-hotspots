/**
 * Worker entrypoint. Runs as its own Node process alongside the web tier
 * (see scripts/start.sh). Boots pg-boss, registers job handlers, and waits
 * forever — pg-boss handles polling/dispatch internally.
 *
 * Slice 2: scaffolding only. The `processCapture` handler is wired but its
 * implementation is a stub until Slice 3 lands the Capture model + API.
 */
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
  process.exit(0);
}

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});
process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});
process.on("unhandledRejection", (reason) => {
  console.error(`[${WORKER_NAME}] unhandledRejection:`, reason);
});

main().catch((err) => {
  console.error(`[${WORKER_NAME}] fatal boot error:`, err);
  process.exit(1);
});

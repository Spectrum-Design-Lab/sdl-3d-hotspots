import { PgBoss } from "pg-boss";

declare global {
  // eslint-disable-next-line no-var
  var __pgBoss: PgBoss | undefined;
  // eslint-disable-next-line no-var
  var __pgBossStartPromise: Promise<PgBoss> | undefined;
}

export const JOB_NAMES = {
  PROCESS_CAPTURE: "process_capture",
} as const;

export type JobName = (typeof JOB_NAMES)[keyof typeof JOB_NAMES];

function getConnectionString(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is required for pg-boss");
  }
  return url;
}

async function buildBoss(): Promise<PgBoss> {
  const boss = new PgBoss({
    connectionString: getConnectionString(),
    schema: process.env.PGBOSS_SCHEMA ?? "pgboss",
    application_name: "sdl-3d-hotspots",
  });

  boss.on("error", (err: unknown) => {
    console.error("[pg-boss] error:", err);
  });

  await boss.start();

  // Pre-create the queues we use so send()/work() never 404 on a fresh DB.
  for (const queueName of Object.values(JOB_NAMES)) {
    try {
      await boss.createQueue(queueName);
    } catch (err) {
      // createQueue is idempotent in pg-boss v12 but log just in case.
      if (!(err instanceof Error) || !/already exists/i.test(err.message)) {
        throw err;
      }
    }
  }

  return boss;
}

export async function getBoss(): Promise<PgBoss> {
  if (global.__pgBoss) return global.__pgBoss;
  if (!global.__pgBossStartPromise) {
    global.__pgBossStartPromise = buildBoss().then((instance) => {
      global.__pgBoss = instance;
      return instance;
    });
  }
  return global.__pgBossStartPromise;
}

export async function enqueue<T extends object>(
  name: JobName,
  data: T,
): Promise<string | null> {
  const boss = await getBoss();
  return boss.send(name, data);
}

export type QueueJob<T> = { id: string; data: T };
export type JobHandler<T> = (job: QueueJob<T>) => Promise<void>;

export async function registerWorker<T extends object>(
  name: JobName,
  handler: JobHandler<T>,
): Promise<string> {
  const boss = await getBoss();
  return boss.work<T>(name, async (jobs: Array<{ id: string; data: T }>) => {
    for (const job of jobs) {
      await handler({ id: job.id, data: job.data });
    }
  });
}

export async function stopBoss(): Promise<void> {
  const boss = global.__pgBoss;
  if (!boss) return;
  await boss.stop({ graceful: true, timeout: 30_000 });
  global.__pgBoss = undefined;
  global.__pgBossStartPromise = undefined;
}

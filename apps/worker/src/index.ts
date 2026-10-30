import {
  Queues,
  SCHEDULER_QUEUE,
  accountQueueName,
  addDays,
  killSwitchState,
  quarterHourBucket,
  redisConnection,
  syncConnectionAssets,
  syncableAccounts,
  todayIn,
  type AccountJobData,
} from "@fahd/core";
import { createDb } from "@fahd/db";
import { metaConnections } from "@fahd/db/schema";
import { DelayedError, Queue, Worker, type Job } from "bullmq";
import { ne } from "drizzle-orm";
import { backoffDelay, processAccountJob } from "./processor";

const db = createDb();
const connection = redisConnection();
const queues = new Queues(connection);
const accountWorkers = new Map<string, Worker>();

const log = (msg: string, extra: Record<string, unknown> = {}) =>
  console.log(JSON.stringify({ at: new Date().toISOString(), msg, ...extra }));

/** Owners flip it in Settings; running launches check it between steps. */
async function killSwitchOn() {
  return (await killSwitchState(db)).on;
}

/** One worker per ad account queue: one job at a time, at most 2 per second. */
function ensureAccountWorker(adAccountId: string) {
  if (accountWorkers.has(adAccountId)) return;
  const worker = new Worker<AccountJobData>(
    accountQueueName(adAccountId),
    async (job: Job<AccountJobData>, token?: string) => {
      if (await killSwitchOn()) {
        await job.moveToDelayed(Date.now() + 60_000, token);
        throw new DelayedError();
      }
      return processAccountJob(db, job.data, { shouldStop: killSwitchOn });
    },
    {
      connection,
      concurrency: 1,
      limiter: { max: 2, duration: 1_000 },
      settings: { backoffStrategy: (attemptsMade, _type, err) => backoffDelay(attemptsMade, err) },
    },
  );
  worker.on("completed", (job, result) => log("job done", { queue: job.queueName, kind: job.data.kind, result }));
  worker.on("failed", (job, err) => log("job failed", { queue: job?.queueName, kind: job?.data.kind, attempts: job?.attemptsMade, error: err.message }));
  accountWorkers.set(adAccountId, worker);
}

/** Every 15 minutes: objects and today's insights for every syncable account. */
async function tick() {
  const accounts = await syncableAccounts(db);
  const bucket = quarterHourBucket();
  for (const a of accounts) {
    ensureAccountWorker(a.id);
    const today = todayIn(a.timezone);
    await queues.add({ kind: "sync-objects", adAccountId: a.id }, bucket);
    await queues.add({ kind: "sync-insights", adAccountId: a.id, since: today, until: today }, bucket);
  }
  return { accounts: accounts.length };
}

/** Nightly: the last 28 days through Meta's async report runs. */
async function backfill() {
  const accounts = await syncableAccounts(db);
  for (const a of accounts) {
    ensureAccountWorker(a.id);
    const yesterday = addDays(todayIn(a.timezone), -1);
    await queues.add({ kind: "backfill", adAccountId: a.id, since: addDays(yesterday, -27), until: yesterday }, yesterday);
  }
  return { accounts: accounts.length };
}

/** Daily: ad accounts, pages, Instagram accounts and pixels per Business Manager. */
async function assets() {
  const connections = await db.select({ id: metaConnections.id }).from(metaConnections).where(ne(metaConnections.status, "broken"));
  for (const c of connections) await syncConnectionAssets(db, c.id);
  return { connections: connections.length };
}

const scheduler = new Queue(SCHEDULER_QUEUE, { connection });
await scheduler.upsertJobScheduler("tick", { every: 15 * 60_000 }, { name: "tick" });
await scheduler.upsertJobScheduler("assets", { pattern: "17 3 * * *" }, { name: "assets" });
await scheduler.upsertJobScheduler("backfill", { pattern: "41 4 * * *" }, { name: "backfill" });

const schedulerWorker = new Worker(
  SCHEDULER_QUEUE,
  async (job) => {
    if (await killSwitchOn()) return { skipped: "kill switch on" };
    if (job.name === "tick") return tick();
    if (job.name === "backfill") return backfill();
    if (job.name === "assets") return assets();
    if (job.name === "start-account") return ensureAccountWorker(String(job.data.adAccountId));
    return null;
  },
  { connection, concurrency: 1 },
);
schedulerWorker.on("completed", (job, result) => log(`${job.name} done`, { result }));
schedulerWorker.on("failed", (job, err) => log(`${job?.name} failed`, { error: err.message }));

// Workers for accounts that already exist, then a first sync straight away.
for (const a of await syncableAccounts(db)) ensureAccountWorker(a.id);
await scheduler.add("tick", {}, { removeOnComplete: true });
log("worker started", { accounts: accountWorkers.size });

async function shutdown() {
  log("worker stopping");
  await Promise.all([schedulerWorker.close(), ...[...accountWorkers.values()].map((w) => w.close())]);
  await Promise.all([scheduler.close(), queues.close()]);
  connection.disconnect();
  await db.$client.end();
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

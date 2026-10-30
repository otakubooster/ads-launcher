import { Queue, type JobsOptions } from "bullmq";
import { Redis } from "ioredis";

/**
 * One BullMQ queue per ad account (concurrency 1, 2 jobs/s in the worker) so
 * Meta writes to an account never overlap (docs/spec.md → Rate limits).
 */
export const SCHEDULER_QUEUE = "scheduler";

export const accountQueueName = (adAccountId: string) => `account-${adAccountId}`;

export type AccountJobData =
  | { kind: "sync-objects"; adAccountId: string }
  | { kind: "sync-insights"; adAccountId: string; since: string; until: string }
  | { kind: "backfill"; adAccountId: string; since: string; until: string }
  | { kind: "upload"; adAccountId: string; creativeId: string }
  | { kind: "launch"; adAccountId: string; launchId: string };

export const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 4,
  backoff: { type: "meta" },
  removeOnComplete: { age: 86_400, count: 1_000 },
  removeOnFail: { age: 7 * 86_400 },
};

export function redisConnection(url = process.env.REDIS_URL) {
  if (!url) throw new Error("REDIS_URL is not set");
  return new Redis(url, { maxRetriesPerRequest: null });
}

/** Producer side, used by the web app and the scheduler. */
export class Queues {
  private readonly cache = new Map<string, Queue>();
  constructor(readonly connection: Redis) {}

  account(adAccountId: string) {
    const name = accountQueueName(adAccountId);
    let q = this.cache.get(name);
    if (!q) {
      q = new Queue(name, { connection: this.connection, defaultJobOptions: DEFAULT_JOB_OPTIONS });
      this.cache.set(name, q);
    }
    return q;
  }

  /**
   * Adds a job. `dedupeKey` makes repeats within the same window a no-op
   * (BullMQ ignores a second job with the same id while the first exists).
   */
  add(data: AccountJobData, dedupeKey?: string, opts: JobsOptions = {}) {
    return this.account(data.adAccountId).add(data.kind, data, { ...opts, jobId: dedupeKey ? `${data.kind}-${data.adAccountId}-${dedupeKey}` : undefined });
  }

  async close() {
    await Promise.all([...this.cache.values()].map((q) => q.close()));
  }
}

/** The 15-minute bucket a job belongs to, for dedupe keys. */
export function quarterHourBucket(now = new Date()) {
  return Math.floor(now.getTime() / (15 * 60_000)).toString(36);
}

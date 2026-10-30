import { LIMITS } from "./config";
import { MetaApiError } from "./errors";
import { pauseUntil, type UsageSnapshot } from "./usage";

type Clock = { now?: () => number; sleep?: (ms: number) => Promise<void> };

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Per-ad-account throttle for one process: writes run one at a time, at least
 * 500 ms apart (2 per second), and every call to an account waits while Meta's
 * usage for it is at or above 75%. Waits longer than LIMITS.maxInlineWaitMs
 * throw a rate_limit error with retryAfterMs so a queue can reschedule instead.
 *
 * The worker gets the same rules across processes from BullMQ (one queue per
 * account, concurrency 1, limiter) and calls record() with every response.
 */
export class Throttle {
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly writeChains = new Map<string, Promise<unknown>>();
  private readonly lastWriteAt = new Map<string, number>();
  private readonly blocked = new Map<string, number>();

  constructor({ now = Date.now, sleep = realSleep }: Clock = {}) {
    this.now = now;
    this.sleep = sleep;
  }

  /** When the account's calls may resume, or null if they may run now. */
  pausedUntil(accountId: string): number | null {
    const until = this.blocked.get(accountId);
    return until !== undefined && until > this.now() ? until : null;
  }

  /** Feed every response's usage headers in; high usage pauses the account. */
  record(accountId: string, usage: UsageSnapshot | null) {
    const until = pauseUntil(usage, this.now());
    if (until !== null) this.block(accountId, until);
  }

  block(accountId: string, untilMs: number) {
    this.blocked.set(accountId, Math.max(untilMs, this.blocked.get(accountId) ?? 0));
  }

  run<T>(accountId: string | null, kind: "read" | "write", fn: () => Promise<T>): Promise<T> {
    if (!accountId) return fn();
    if (kind === "read") return this.waitWhileBlocked(accountId).then(fn);

    const previous = this.writeChains.get(accountId) ?? Promise.resolve();
    const next = previous
      .catch(() => {})
      .then(async () => {
        await this.waitWhileBlocked(accountId);
        const last = this.lastWriteAt.get(accountId);
        const gap = last === undefined ? 0 : last + LIMITS.minWriteIntervalMs - this.now();
        if (gap > 0) await this.sleep(gap);
        this.lastWriteAt.set(accountId, this.now());
        return fn();
      });
    this.writeChains.set(accountId, next);
    void next.finally(() => {
      if (this.writeChains.get(accountId) === next) this.writeChains.delete(accountId);
    }).catch(() => {});
    return next;
  }

  private async waitWhileBlocked(accountId: string) {
    const until = this.pausedUntil(accountId);
    if (until === null) return;
    const wait = until - this.now();
    if (wait > LIMITS.maxInlineWaitMs) {
      throw new MetaApiError({
        kind: "rate_limit",
        message: `Ad account ${accountId} is paused until ${new Date(until).toISOString()} because Meta usage is high`,
        retryAfterMs: wait,
      });
    }
    await this.sleep(wait);
  }
}

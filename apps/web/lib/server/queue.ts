import "server-only";
import { Queues, redisConnection } from "@fahd/core";

const globalForQueues = globalThis as unknown as { __queues?: Queues | null };

/** Job producer, or null without REDIS_URL (then work runs inline). */
export function getQueues(): Queues | null {
  if (globalForQueues.__queues === undefined) {
    globalForQueues.__queues = process.env.REDIS_URL ? new Queues(redisConnection()) : null;
  }
  return globalForQueues.__queues;
}

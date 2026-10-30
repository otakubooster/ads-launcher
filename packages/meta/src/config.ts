/** Pinned Graph API version. Bump once a year; Marketing API versions live about a year. */
export const DEFAULT_API_VERSION = "v26.0";

export const GRAPH_HOST = "https://graph.facebook.com";

/**
 * META_GRAPH_HOST points the client at the fake Graph server in development and
 * tests. Ignored in production so a token can never be sent anywhere but Meta.
 */
export function graphHost() {
  const override = process.env.META_GRAPH_HOST;
  return override && process.env.NODE_ENV !== "production" ? override.replace(/\/$/, "") : GRAPH_HOST;
}

/** Permissions the system user token needs (docs/spec.md → Meta setup checklist). */
export const REQUIRED_PERMISSIONS = [
  "ads_management",
  "ads_read",
  "business_management",
  "pages_show_list",
  "pages_read_engagement",
  "pages_manage_ads",
  "pages_manage_metadata",
  "instagram_basic",
] as const;

/** Rules from docs/spec.md → Rate limits and throttling. */
export const LIMITS = {
  /** Any usage value at or above this pauses the account. */
  pauseAtPct: 75,
  /** At most 2 writes per second per ad account. */
  minWriteIntervalMs: 500,
  /** Never more than 3 retries for any request. */
  maxRetries: 3,
  /** Temporary errors (codes 1, 2): retry twice, after 2 s and then 8 s. */
  temporaryBackoffMs: [2_000, 8_000],
  /** Pause when usage is high but Meta gives no reset time. */
  defaultPauseMs: 60_000,
  /** Longer waits are not slept in-process; the error carries retryAfterMs for the queue. */
  maxInlineWaitMs: 30_000,
  /** Graph batch endpoint limit. */
  maxBatchSize: 50,
  requestTimeoutMs: 60_000,
} as const;

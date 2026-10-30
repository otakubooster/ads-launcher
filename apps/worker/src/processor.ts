import {
  backfillInsights,
  markConnectionBroken,
  storageFromEnv,
  syncAccountObjects,
  syncInsights,
  uploadCreativeToAccount,
  type AccountJobData,
  type AnyDb,
} from "@fahd/core";
import { adAccounts } from "@fahd/db/schema";
import { MetaApiError } from "@fahd/meta";
import { UnrecoverableError } from "bullmq";
import { eq } from "drizzle-orm";

/** Errors that will fail the same way on every retry (docs/spec.md → Error handling). */
const FINAL_KINDS = new Set(["auth", "permission", "validation", "policy", "guard"]);

export async function processAccountJob(db: AnyDb, data: AccountJobData): Promise<unknown> {
  try {
    switch (data.kind) {
      case "sync-objects":
        return await syncAccountObjects(db, data.adAccountId);
      case "sync-insights":
        return { rows: await syncInsights(db, data.adAccountId, data) };
      case "backfill":
        return { rows: await backfillInsights(db, data.adAccountId, data) };
      case "upload":
        return await uploadCreativeToAccount(db, storageFromEnv(), data.creativeId, data.adAccountId);
      default:
        throw new UnrecoverableError(`No processor for ${data.kind} yet`);
    }
  } catch (e) {
    if (e instanceof MetaApiError) {
      if (e.kind === "auth") {
        const [account] = await db.select({ connectionId: adAccounts.connectionId }).from(adAccounts).where(eq(adAccounts.id, data.adAccountId));
        if (account) await markConnectionBroken(db, account.connectionId, e);
      }
      if (FINAL_KINDS.has(e.kind)) throw new UnrecoverableError(`${e.kind}: ${e.message}`);
    }
    throw e;
  }
}

/** Retry delay: Meta's own wait for rate limits, otherwise exponential up to 15 minutes. */
export function backoffDelay(attemptsMade: number, err?: Error) {
  if (err instanceof MetaApiError && err.retryAfterMs) return err.retryAfterMs;
  return Math.min(30_000 * 2 ** Math.max(0, attemptsMade - 1), 15 * 60_000);
}

import type { MetaClient } from "./client";
import { REQUIRED_PERMISSIONS } from "./config";
import { MetaApiError } from "./errors";

/** Typed wrappers for the calls in docs/spec.md → Read and sync. Creates arrive with the launch runner. */

export type PermissionGrant = { permission: string; status: "granted" | "declined" | "expired" };

export async function getTokenPermissions(client: MetaClient) {
  const res = await client.get<{ data: PermissionGrant[] }>("me/permissions");
  return res.data;
}

/** Required permissions the token lacks, in the spec's order. */
export function missingPermissions(grants: PermissionGrant[]) {
  const granted = new Set(grants.filter((g) => g.status === "granted").map((g) => g.permission));
  return REQUIRED_PERMISSIONS.filter((p) => !granted.has(p));
}

export type GraphAdAccount = {
  id: string;
  name: string;
  currency: string;
  timezone_name: string;
  account_status: number;
  /** Lifetime spend in the account currency's minor unit, as a string. */
  amount_spent: string;
};

const AD_ACCOUNT_FIELDS = "id,name,currency,timezone_name,account_status,amount_spent";

/** Owned and client ad accounts of one Business Manager, deduplicated. */
export async function listBusinessAdAccounts(client: MetaClient, businessId: string) {
  const byId = new Map<string, GraphAdAccount>();
  for (const edge of ["owned_ad_accounts", "client_ad_accounts"]) {
    for await (const account of client.paginate<GraphAdAccount>(`${businessId}/${edge}`, {
      fields: AD_ACCOUNT_FIELDS,
      limit: 200,
    })) {
      byId.set(account.id, account);
    }
  }
  return [...byId.values()];
}

export type GraphPage = { id: string; name: string };
export type GraphInstagramAccount = { id: string; username: string };
export type GraphPixel = { id: string; name: string };

export async function listOwnedPages(client: MetaClient, businessId: string) {
  return collect(client.paginate<GraphPage>(`${businessId}/owned_pages`, { fields: "id,name", limit: 200 }));
}

export async function listInstagramAccounts(client: MetaClient, adAccountId: string) {
  return collect(
    client.paginate<GraphInstagramAccount>(`${adAccountId}/instagram_accounts`, { fields: "id,username", limit: 200 }),
  );
}

export async function listPixels(client: MetaClient, adAccountId: string) {
  return collect(client.paginate<GraphPixel>(`${adAccountId}/adspixels`, { fields: "id,name", limit: 200 }));
}

/**
 * Pause or activate a campaign, ad set or ad. Activation is a separate,
 * confirmed action in the app; callers write change_log before and after.
 */
export function setStatus(client: MetaClient, objectId: string, status: "ACTIVE" | "PAUSED", adAccountId: string) {
  return client.post<{ success: boolean }>(objectId, { status }, { accountId: adAccountId });
}

/** Budgets are in the account currency's minor unit (cents). */
export function setDailyBudget(client: MetaClient, objectId: string, dailyBudgetMinor: number, adAccountId: string) {
  if (!Number.isInteger(dailyBudgetMinor) || dailyBudgetMinor <= 0) {
    throw new MetaApiError({ kind: "guard", message: "Daily budget must be a positive whole number of minor units" });
  }
  return client.post<{ success: boolean }>(objectId, { daily_budget: dailyBudgetMinor }, { accountId: adAccountId });
}

async function collect<T>(items: AsyncIterable<T>) {
  const out: T[] = [];
  for await (const item of items) out.push(item);
  return out;
}

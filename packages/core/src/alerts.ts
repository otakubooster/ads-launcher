import { alerts, users } from "@fahd/db/schema";
import { eq } from "drizzle-orm";
import type { AnyDb } from "./types";

export type AlertKind = "token_failure" | "account_disabled" | "policy_block" | "launch_failed";

/**
 * Emails every owner once per dedupe key (docs/spec.md → Audit and safety). Sends
 * through Resend when RESEND_API_KEY is set; otherwise records the alert unsent.
 * Never throws: an alert must not break the job that raised it.
 */
export async function sendAlert(db: AnyDb, alert: { kind: AlertKind; dedupeKey: string; subject: string; body: string }, fetchImpl: typeof fetch = fetch) {
  try {
    const owners = await db.select({ email: users.email }).from(users).where(eq(users.role, "owner"));
    const recipients = owners.map((o) => o.email);
    const [row] = await db
      .insert(alerts)
      .values({ ...alert, recipients })
      .onConflictDoNothing({ target: alerts.dedupeKey })
      .returning({ id: alerts.id });
    if (!row) return { sent: false, duplicate: true };
    const key = process.env.RESEND_API_KEY;
    if (!key || recipients.length === 0) {
      await db.update(alerts).set({ error: key ? "No owner to email" : "RESEND_API_KEY not set" }).where(eq(alerts.id, row.id));
      return { sent: false, duplicate: false };
    }
    const res = await fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ from: process.env.ALERT_EMAIL_FROM ?? "Fahd Ads Launcher <alerts@resend.dev>", to: recipients, subject: alert.subject, text: alert.body }),
    });
    if (!res.ok) {
      await db.update(alerts).set({ error: `Resend ${res.status}: ${(await res.text()).slice(0, 300)}` }).where(eq(alerts.id, row.id));
      return { sent: false, duplicate: false };
    }
    await db.update(alerts).set({ sentAt: new Date() }).where(eq(alerts.id, row.id));
    return { sent: true, duplicate: false };
  } catch (e) {
    console.error("alert failed", e);
    return { sent: false, duplicate: false };
  }
}

const appUrl = () => process.env.APP_URL ?? "http://localhost:3000";
const day = () => new Date().toISOString().slice(0, 10);

export const ALERTS = {
  tokenFailure: (connectionId: string, businessName: string, message: string) => ({
    kind: "token_failure" as const,
    dedupeKey: `token:${connectionId}:${day()}`,
    subject: `Meta connection stopped working: ${businessName}`,
    body: `The system user token for ${businessName} failed: ${message}\n\nSyncs and launches for its ad accounts are stopped. Generate a new token and use Replace token:\n${appUrl()}/settings`,
  }),
  accountDisabled: (accountId: string, accountName: string, status: number) => ({
    kind: "account_disabled" as const,
    dedupeKey: `account:${accountId}:${status}`,
    subject: `Ad account disabled: ${accountName}`,
    body: `Meta reports ${accountName} with account status ${status} (1 is active). Ads in it are not delivering.\n\nCheck it in Meta Business Settings, then refresh:\n${appUrl()}/settings`,
  }),
  policyBlock: (accountId: string, accountName: string, message: string) => ({
    kind: "policy_block" as const,
    dedupeKey: `policy:${accountId}:${day()}`,
    subject: `Meta blocked ${accountName} for policy (error 368)`,
    body: `${message}\n\nLaunches in ${accountName} are stopped. Review the account's quality and policy status in Meta.\n${appUrl()}/launches`,
  }),
  launchFailed: (launchId: string, name: string) => ({
    kind: "launch_failed" as const,
    dedupeKey: `launch:${launchId}:failed`,
    subject: `Launch failed: ${name}`,
    body: `No ads were created for "${name}". Open the launch log for Meta's errors and Retry failed items:\n${appUrl()}/launches/${launchId}`,
  }),
};

import { alerts } from "@fahd/db/schema";
import { createTestDb } from "@fahd/db/testing";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { ALERTS, evaluateGuardrails, killSwitchState, sendAlert, setKillSwitch } from "../src";

const base = { accountName: "Lumen US", currency: "USD", total: 50_000, max: 100_000, approvalThreshold: 20_000, maxChangePct: 30 };

describe("evaluateGuardrails (week 4 check)", () => {
  it("blocks anyone above the account's max daily budget", () => {
    const d = evaluateGuardrails({ ...base, role: "owner", increase: 60_000 });
    expect(d).toMatchObject({ decision: "block", reason: "max_daily_budget", newTotal: 110_000 });
    if (d.decision !== "allow") expect(d.detail).toBe("This would take Lumen US to $1,100.00/day. The limit is $1,000.00/day.");
  });

  it("lets owners and admins raise spend below the max without approval", () => {
    expect(evaluateGuardrails({ ...base, role: "admin", increase: 40_000, changePct: 200 }).decision).toBe("allow");
  });

  it("sends a buyer's increase above the threshold for approval", () => {
    expect(evaluateGuardrails({ ...base, role: "buyer", increase: 25_000 })).toMatchObject({ decision: "approval", reason: "approval_threshold" });
    expect(evaluateGuardrails({ ...base, role: "buyer", increase: 20_000 }).decision).toBe("allow");
  });

  it("limits a buyer's budget step to 30%, both ways", () => {
    expect(evaluateGuardrails({ ...base, role: "buyer", increase: 1_000, changePct: 31 })).toMatchObject({ decision: "block", reason: "max_change" });
    expect(evaluateGuardrails({ ...base, role: "buyer", increase: 0, changePct: -40 })).toMatchObject({ decision: "block", reason: "max_change" });
    expect(evaluateGuardrails({ ...base, role: "buyer", increase: 1_000, changePct: 30 }).decision).toBe("allow");
  });

  it("never blocks pauses and cuts on the account max", () => {
    expect(evaluateGuardrails({ ...base, total: 500_000, role: "buyer", increase: 0 }).decision).toBe("allow");
  });

  it("ignores limits that aren't set", () => {
    expect(evaluateGuardrails({ ...base, max: null, approvalThreshold: null, role: "buyer", increase: 9_000_000 }).decision).toBe("allow");
  });
});

describe("alerts and the kill switch", () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  beforeAll(async () => {
    db = await createTestDb({ minimal: true });
  });

  it("emails owners once per dedupe key through Resend", async () => {
    process.env.RESEND_API_KEY = "re_test";
    const calls: { url: string; body: { to: string[]; subject: string } }[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)) });
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    const alert = ALERTS.launchFailed("00000000-0000-4000-8000-000000000123", "Glow test");
    expect(await sendAlert(db, alert, fetchImpl)).toEqual({ sent: true, duplicate: false });
    expect(await sendAlert(db, alert, fetchImpl)).toEqual({ sent: false, duplicate: true });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://api.resend.com/emails");
    expect(calls[0]!.body.subject).toBe("Launch failed: Glow test");
    expect(calls[0]!.body.to).toHaveLength(1);
    const [row] = await db.select().from(alerts).where(eq(alerts.dedupeKey, alert.dedupeKey));
    expect(row!.sentAt).not.toBeNull();
  });

  it("records an alert it could not send instead of throwing", async () => {
    delete process.env.RESEND_API_KEY;
    expect(await sendAlert(db, ALERTS.accountDisabled("00000000-0000-4000-8000-000000000124", "Lumen UK", 2))).toEqual({ sent: false, duplicate: false });
    const [row] = await db.select().from(alerts).where(eq(alerts.dedupeKey, "account:00000000-0000-4000-8000-000000000124:2"));
    expect(row!.error).toBe("RESEND_API_KEY not set");
  });

  it("keeps the kill switch in the database", async () => {
    expect(await killSwitchState(db)).toEqual({ on: false });
    const { users } = await import("@fahd/db/schema");
    const [owner] = await db.select().from(users).where(eq(users.role, "owner"));
    await setKillSwitch(db, true, owner!.id);
    expect(await killSwitchState(db)).toMatchObject({ on: true, by: owner!.id });
    await setKillSwitch(db, false, owner!.id);
    expect((await killSwitchState(db)).on).toBe(false);
  });
});

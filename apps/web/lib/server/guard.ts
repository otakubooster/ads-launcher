import "server-only";
import { budgetReleasedBy, checkSpend, killSwitchState, type GuardDecision, type ObjectLevel } from "@fahd/core";
import { approvalRequests, launchItems, launches, metaAdsets, metaAds, metaCampaigns, presets } from "@fahd/db/schema";
import { eq } from "drizzle-orm";
import { UserError } from "./action-result";
import type { Session } from "./auth";
import { asUser, getDb } from "./db";

const TABLES = { campaign: metaCampaigns, adset: metaAdsets, ad: metaAds } as const;

/** Thrown for a blocked change; runAction and the bulk summaries show the guardrail's copy. */
export class GuardrailError extends UserError {
  constructor(readonly decision: Exclude<GuardDecision, { decision: "allow" }>) {
    super(decision.title, decision.detail, decision.fix);
  }
}

export type Guarded = { status: "allow" } | { status: "approval"; requestId: string; detail: string };

async function objectRow(level: ObjectLevel, id: string) {
  const t = TABLES[level];
  const [row] = await getDb()
    .select({ adAccountId: t.adAccountId, name: t.name, status: t.status, ...(level === "ad" ? {} : { dailyBudget: (t as typeof metaAdsets).dailyBudget }) })
    .from(t)
    .where(eq(t.id, id));
  if (!row) throw new Error(`${level} not found`);
  return row as { adAccountId: string; name: string; status: string; dailyBudget?: number | null };
}

async function decide(
  session: Session,
  decision: GuardDecision,
  request: Omit<typeof approvalRequests.$inferInsert, "requestedBy" | "status">,
): Promise<Guarded> {
  if (decision.decision === "allow") return { status: "allow" };
  if (decision.decision === "block") throw new GuardrailError(decision);
  const [row] = await asUser(session.userId, (tx) =>
    tx.insert(approvalRequests).values({ ...request, requestedBy: session.userId }).returning({ id: approvalRequests.id }),
  );
  return { status: "approval", requestId: row!.id, detail: decision.detail };
}

/** Activation releases the object's budget (docs/spec.md → Spend guardrails). */
export async function guardActivate(session: Session, level: ObjectLevel, id: string): Promise<Guarded> {
  const obj = await objectRow(level, id);
  const increase = obj.status === "ACTIVE" ? 0 : await budgetReleasedBy(getDb(), level, id);
  const decision = await checkSpend(getDb(), { adAccountId: obj.adAccountId, role: session.role, increase });
  return decide(session, decision, { adAccountId: obj.adAccountId, kind: "activate", entityLevel: level, entityId: id, entityName: obj.name, payload: { status: "ACTIVE" }, increase });
}

/** A budget edit: only an active object's increase counts toward the account total. */
export async function guardBudget(session: Session, level: "campaign" | "adset", id: string, next: number): Promise<Guarded> {
  const obj = await objectRow(level, id);
  const before = obj.dailyBudget ?? null;
  const changePct = before ? ((next - before) / before) * 100 : null;
  const increase = obj.status === "ACTIVE" && before !== null ? Math.max(0, next - before) : 0;
  const decision = await checkSpend(getDb(), { adAccountId: obj.adAccountId, role: session.role, increase, changePct });
  return decide(session, decision, {
    adAccountId: obj.adAccountId,
    kind: "budget",
    entityLevel: level,
    entityId: id,
    entityName: obj.name,
    payload: { dailyBudget: next, before },
    increase,
  });
}

/** What a launch adds per day once activated: its new campaign budget, or its new ad sets'. */
export async function launchIncrease(launchId: string) {
  const items = await getDb().select().from(launchItems).where(eq(launchItems.launchId, launchId));
  const campaign = items.find((i) => i.level === "campaign")?.payload as { source: string; dailyBudget: number | null } | undefined;
  if (campaign?.source === "new" && campaign.dailyBudget) return campaign.dailyBudget;
  return items
    .filter((i) => i.level === "adset")
    .map((i) => i.payload as { source: string; dailyBudget: number | null })
    .filter((p) => p.source !== "existing")
    .reduce((sum, p) => sum + (p.dailyBudget ?? 0), 0);
}

export async function guardLaunchActivation(session: Session, launchId: string): Promise<Guarded> {
  const [row] = await getDb()
    .select({ adAccountId: presets.adAccountId, name: launches.name })
    .from(launches)
    .innerJoin(presets, eq(presets.id, launches.presetId))
    .where(eq(launches.id, launchId));
  if (!row) throw new Error("Launch not found.");
  const increase = await launchIncrease(launchId);
  const decision = await checkSpend(getDb(), { adAccountId: row.adAccountId, role: session.role, increase });
  return decide(session, decision, { adAccountId: row.adAccountId, kind: "launch_activate", entityId: launchId, entityName: row.name, payload: { status: "ACTIVE" }, increase });
}

/** Writes to Meta stop while the kill switch is on (pauses still go through). */
export async function assertNotKilled() {
  if ((await killSwitchState(getDb())).on) {
    throw new UserError("The kill switch is on", "An owner stopped all queues and launches. Nothing new goes to Meta until it is turned off.", "An owner can turn it off in Settings.");
  }
}

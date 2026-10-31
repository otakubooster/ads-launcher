"use server";

import {
  duplicateObject,
  editAdCopy,
  editObject,
  loadAdCopy,
  loadEditable,
  type AdCopy,
  type EditableObject,
  changeDailyBudget,
  changeStatus,
  quarterHourBucket,
  syncAccountObjects,
  syncInsights,
  syncableAccounts,
  todayIn,
  type MetaChange,
  type ObjectLevel,
} from "@fahd/core";
import { changeLog, savedViews } from "@fahd/db/schema";
import { MetaApiError, describeMetaError } from "@fahd/meta";
import { and, desc, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { DateRange } from "@/lib/date-range";
import { type ActionResult, UserError, runAction } from "@/lib/server/action-result";
import { requireRole } from "@/lib/server/auth";
import { asUser, getDb } from "@/lib/server/db";
import { assertNotKilled, guardActivate, guardBudget } from "@/lib/server/guard";
import { getQueues } from "@/lib/server/queue";

const level = z.enum(["campaign", "adset", "ad"]);
const ids = z.array(z.uuid()).min(1).max(500);

type Failure = { id: string; title: string; detail: string };

/** Runs a Meta write and appends one change_log row with before, after and Meta's response (or error). */
const MIRROR = { campaign: "meta_campaigns", adset: "meta_adsets", ad: "meta_ads" } as const;

async function logged(userId: string, entityLevel: ObjectLevel, objectId: string, action: string, fn: () => Promise<MetaChange>) {
  try {
    const change = await fn();
    await asUser(userId, (tx) =>
      tx.insert(changeLog).values({
        actorId: userId,
        source: "ui",
        entityLevel,
        entityId: change.metaId,
        action,
        before: change.before,
        after: change.after,
        metaResponse: change.metaResponse as object,
      }),
    );
    return change;
  } catch (e) {
    if (e instanceof MetaApiError) {
      await asUser(userId, async (tx) => {
        const [obj] = (await tx.execute(sql`select meta_id from ${sql.raw(MIRROR[entityLevel])} where id = ${objectId}`)) as unknown as { meta_id: string }[];
        await tx.insert(changeLog).values({
          actorId: userId,
          source: "ui",
          entityLevel,
          entityId: obj?.meta_id ?? objectId,
          action: `${action}_failed`,
          metaResponse: { kind: e.kind, code: e.code, message: e.message, userMessage: e.userMessage },
        });
      });
    }
    throw e;
  }
}

function summarize(done: number, failed: Failure[], verb: string, pending = 0): ActionResult<{ failed: Failure[] }> {
  const waiting = pending ? `${pending} sent for approval` : "";
  if (failed.length === 0) {
    const message =
      done || !pending
        ? `${verb} ${done} ${done === 1 ? "item" : "items"}${waiting ? `; ${waiting}` : ""}.`
        : `${pending} ${pending === 1 ? "change" : "changes"} sent for approval: an owner or admin will review ${pending === 1 ? "it" : "them"}.`;
    return { ok: true, message, data: { failed } };
  }
  const first = failed[0]!;
  return {
    ok: false,
    error: {
      title: done ? `${verb} ${done}; ${failed.length} failed` : first.title,
      detail: first.detail,
      fix: failed.length > 1 ? `${failed.length - 1} more failed the same way or similar.` : undefined,
    },
  };
}

function failureOf(id: string, e: unknown): Failure {
  if (e instanceof UserError) return { id, title: e.title, detail: [e.detail, e.fix].filter(Boolean).join(" ") };
  if (e instanceof MetaApiError) {
    const d = describeMetaError(e);
    return { id, title: d.title, detail: `${d.detail} ${d.fix}` };
  }
  return { id, title: "Change failed", detail: e instanceof Error ? e.message : String(e) };
}

export async function setStatusAction(objectLevel: string, objectIds: string[], status: "ACTIVE" | "PAUSED") {
  return runAction(async () => {
    const session = await requireRole("owner", "admin", "buyer");
    const input = z.object({ level, ids, status: z.enum(["ACTIVE", "PAUSED"]) }).parse({ level: objectLevel, ids: objectIds, status });
    if (input.status === "ACTIVE") await assertNotKilled();
    const failed: Failure[] = [];
    let done = 0;
    let pending = 0;
    for (const id of input.ids) {
      try {
        // Each activation is checked against the total the previous ones left.
        if (input.status === "ACTIVE" && (await guardActivate(session, input.level, id)).status === "approval") {
          pending++;
          continue;
        }
        await logged(session.userId, input.level, id, status === "ACTIVE" ? "activate" : "pause", () => changeStatus(getDb(), input.level, id, input.status));
        done++;
      } catch (e) {
        failed.push(failureOf(id, e));
      }
    }
    revalidatePath("/ads");
    return summarize(done, failed, status === "ACTIVE" ? "Activated" : "Paused", pending);
  });
}

export async function setBudgetAction(objectLevel: string, objectId: string, dailyBudget: number) {
  return runAction(async () => {
    const session = await requireRole("owner", "admin", "buyer");
    const input = z
      .object({ level: z.enum(["campaign", "adset"]), id: z.uuid(), dailyBudget: z.number().int().positive() })
      .parse({ level: objectLevel, id: objectId, dailyBudget });
    await assertNotKilled();
    const guard = await guardBudget(session, input.level, input.id, input.dailyBudget);
    if (guard.status === "approval") return { ok: true, message: `Sent for approval. ${guard.detail}` } satisfies ActionResult;
    const change = await logged(session.userId, input.level, input.id, "update_budget", () => changeDailyBudget(getDb(), input.level, input.id, input.dailyBudget));
    revalidatePath("/ads");
    return { ok: true, message: `Budget updated for ${change.name}.` } satisfies ActionResult;
  });
}

/** Moves each budget by pct (e.g. 10 or -20), rounding to whole minor units. */
export async function adjustBudgetsAction(objectLevel: string, objectIds: string[], pct: number, current: Record<string, number>) {
  return runAction(async () => {
    const session = await requireRole("owner", "admin", "buyer");
    const input = z
      .object({ level: z.enum(["campaign", "adset"]), ids, pct: z.number().min(-90).max(500), current: z.record(z.string(), z.number()) })
      .parse({ level: objectLevel, ids: objectIds, pct, current });
    await assertNotKilled();
    const failed: Failure[] = [];
    let done = 0;
    let pending = 0;
    for (const id of input.ids) {
      const before = input.current[id];
      if (!before) continue;
      try {
        const next = Math.max(100, Math.round(before * (1 + input.pct / 100)));
        if ((await guardBudget(session, input.level, id, next)).status === "approval") {
          pending++;
          continue;
        }
        await logged(session.userId, input.level, id, "update_budget", () => changeDailyBudget(getDb(), input.level, id, next));
        done++;
      } catch (e) {
        failed.push(failureOf(id, e));
      }
    }
    revalidatePath("/ads");
    return summarize(done, failed, "Updated budgets on", pending);
  });
}

/** Refreshes from Meta: queued for the worker, or inline without Redis. */
export async function refreshAction(accountIds: string[]): Promise<ActionResult> {
  return runAction(async () => {
    await requireRole();
    const accounts = (await syncableAccounts(getDb())).filter((a) => accountIds.length === 0 || accountIds.includes(a.id));
    const queues = getQueues();
    if (queues) {
      const bucket = `manual-${quarterHourBucket()}-${Date.now() >> 15}`;
      for (const a of accounts) {
        const today = todayIn(a.timezone);
        await queues.add({ kind: "sync-objects", adAccountId: a.id }, bucket);
        await queues.add({ kind: "sync-insights", adAccountId: a.id, since: today, until: today }, bucket);
      }
      return { ok: true, message: `Sync queued for ${accounts.length} ${accounts.length === 1 ? "account" : "accounts"}.` };
    }
    for (const a of accounts) {
      const today = todayIn(a.timezone);
      await syncAccountObjects(getDb(), a.id);
      await syncInsights(getDb(), a.id, { since: today, until: today });
    }
    revalidatePath("/", "layout");
    return { ok: true, message: `Synced ${accounts.length} ${accounts.length === 1 ? "account" : "accounts"}.` };
  });
}

export type EntityDetail = {
  daily: { date: string; spend: number; purchases: number; purchaseValue: number; impressions: number }[];
  history: { id: string; at: string; action: string; source: string; actor: string | null; before: unknown; after: unknown }[];
  settings: { label: string; value: string }[];
};

const VIEW_BY_LEVEL = { campaign: ["campaign_insights_daily", "campaign_id"], adset: ["adset_insights_daily", "adset_id"], ad: ["ad_insights_daily", "ad_id"] } as const;

export async function loadDetailAction(objectLevel: string, objectId: string, range: DateRange): Promise<ActionResult<EntityDetail>> {
  return runAction(async () => {
    const session = await requireRole();
    const input = z.object({ level, id: z.uuid() }).parse({ level: objectLevel, id: objectId });
    const [view, column] = VIEW_BY_LEVEL[input.level];
    const table = input.level === "campaign" ? "meta_campaigns" : input.level === "adset" ? "meta_adsets" : "meta_ads";
    return asUser(session.userId, async (tx) => {
      const daily = (await tx.execute(sql`
        select date::text, spend::float8, purchases::float8, purchase_value::float8 as "purchaseValue", impressions::float8
        from ${sql.raw(view)} where ${sql.raw(column)} = ${input.id}
          and date between ${range.since}::date and ${range.until}::date order by date`)) as unknown as EntityDetail["daily"];
      const [obj] = (await tx.execute(sql`select meta_id, raw from ${sql.raw(table)} where id = ${input.id}`)) as unknown as { meta_id: string; raw: Record<string, unknown> }[];
      const history = await tx
        .select({ id: changeLog.id, at: changeLog.createdAt, action: changeLog.action, source: changeLog.source, actor: sql<string | null>`(select coalesce(name, email) from users where id = ${changeLog.actorId})`, before: changeLog.before, after: changeLog.after })
        .from(changeLog)
        .where(and(eq(changeLog.entityLevel, input.level), eq(changeLog.entityId, obj?.meta_id ?? "")))
        .orderBy(desc(changeLog.createdAt))
        .limit(50);
      const raw = obj?.raw ?? {};
      const countries = (raw.targeting as { geo_locations?: { countries?: string[] } } | undefined)?.geo_locations?.countries;
      const settings = [
        ["Meta ID", obj?.meta_id],
        ["Objective", raw.objective],
        ["Optimization goal", raw.optimization_goal],
        ["Billing event", raw.billing_event],
        ["Bid strategy", raw.bid_strategy],
        ["Countries", countries?.join(", ")],
        ["Advantage+ audience", (raw.targeting as { targeting_automation?: { advantage_audience?: number } } | undefined)?.targeting_automation?.advantage_audience ? "On" : undefined],
        ["Pixel", (raw.promoted_object as { pixel_id?: string } | undefined)?.pixel_id],
        ["Learning", (raw.learning_stage_info as { status?: string } | undefined)?.status],
        ["Creative", (raw.creative as { id?: string } | undefined)?.id],
      ]
        .filter(([, v]) => v !== undefined && v !== null && v !== "")
        .map(([label, value]) => ({ label: String(label), value: String(value).replace(/_/g, " ") }));
      return { ok: true, data: { daily, settings, history: history.map((h) => ({ ...h, at: h.at.toISOString() })) } } satisfies ActionResult<EntityDetail>;
    });
  });
}

const viewInput = z.object({
  name: z.string().trim().min(1, "Name the view.").max(60),
  level,
  columns: z.array(z.string()).max(40),
  filters: z.record(z.string(), z.unknown()),
  sort: z.array(z.object({ id: z.string(), desc: z.boolean() })).max(3),
});

export async function saveViewAction(view: z.infer<typeof viewInput>): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const session = await requireRole();
    const input = viewInput.parse(view);
    const [row] = await asUser(session.userId, (tx) =>
      tx.insert(savedViews).values({ userId: session.userId, ...input }).returning({ id: savedViews.id }),
    );
    revalidatePath("/ads");
    return { ok: true, message: `Saved view "${input.name}".`, data: { id: row!.id } };
  });
}

export async function deleteViewAction(id: string): Promise<ActionResult> {
  return runAction(async () => {
    const session = await requireRole();
    await asUser(session.userId, (tx) => tx.delete(savedViews).where(eq(savedViews.id, z.uuid().parse(id))));
    revalidatePath("/ads");
    return { ok: true, message: "View deleted." };
  });
}

export type DuplicateTarget = { id: string; name: string; parentName: string | null };

/** Campaigns (for ad sets) or ad sets (for ads) in one account, for "Existing campaign / ad set". */
export async function loadDuplicateTargets(objectLevel: string, adAccountId: string): Promise<ActionResult<DuplicateTarget[]>> {
  return runAction(async () => {
    const session = await requireRole("owner", "admin", "buyer");
    const input = z.object({ level: z.enum(["adset", "ad"]), account: z.uuid() }).parse({ level: objectLevel, account: adAccountId });
    const rows = await asUser(session.userId, (tx) =>
      input.level === "adset"
        ? tx.execute(sql`select id, name, null as parent_name from meta_campaigns where ad_account_id = ${input.account} and status not in ('DELETED', 'ARCHIVED') order by name`)
        : tx.execute(sql`select s.id, s.name, c.name as parent_name from meta_adsets s join meta_campaigns c on c.id = s.campaign_id
            where s.ad_account_id = ${input.account} and s.status not in ('DELETED', 'ARCHIVED') order by c.name, s.name`),
    );
    return { ok: true, data: (rows as unknown as { id: string; name: string; parent_name: string | null }[]).map((r) => ({ id: r.id, name: r.name, parentName: r.parent_name })) };
  });
}

/** Ads Manager's Duplicate: copies are created paused, each logged with Meta's response. */
export async function duplicateAction(objectLevel: string, objectIds: string[], options: { copies: number; destinationId?: string | null }) {
  return runAction(async () => {
    const session = await requireRole("owner", "admin", "buyer");
    const input = z
      .object({ level, ids: z.array(z.uuid()).min(1).max(50), copies: z.number().int().min(1).max(10), destinationId: z.uuid().nullish() })
      .parse({ level: objectLevel, ids: objectIds, ...options });
    await assertNotKilled();
    const failed: Failure[] = [];
    let created = 0;
    for (const id of input.ids) {
      try {
        const result = await duplicateObject(getDb(), { level: input.level, id, copies: input.copies, destinationId: input.destinationId });
        await asUser(session.userId, (tx) =>
          tx.insert(changeLog).values(
            result.copies.map((c) => ({
              actorId: session.userId,
              source: "ui" as const,
              entityLevel: input.level,
              entityId: c.copiedId || result.metaId,
              action: "duplicate",
              before: { sourceId: result.metaId, name: result.name },
              after: { copiedId: c.copiedId, status: "PAUSED" },
              metaResponse: c.response as object,
            })),
          ),
        );
        created += result.copies.length;
      } catch (e) {
        failed.push(failureOf(id, e));
      }
    }
    revalidatePath("/ads");
    if (failed.length === 0) return { ok: true, message: `Created ${created} ${created === 1 ? "copy" : "copies"}, paused.`, data: { failed } };
    return summarize(created, failed, "Created copies of");
  });
}

/** The edit pane's current values (from Meta's last synced JSON) and the account currency. */
export async function loadEditAction(objectLevel: string, objectId: string): Promise<ActionResult<EditableObject & { currency: string }>> {
  return runAction(async () => {
    const session = await requireRole("owner", "admin", "buyer");
    const input = z.object({ level, id: z.uuid() }).parse({ level: objectLevel, id: objectId });
    // RLS: the member must be able to read the object before we load it privileged.
    const table = MIRROR[input.level];
    const [row] = (await asUser(session.userId, (tx) =>
      tx.execute(sql`select a.currency from ${sql.raw(table)} o join ad_accounts a on a.id = o.ad_account_id where o.id = ${input.id}`),
    )) as unknown as { currency: string }[];
    if (!row) throw new UserError("Not found", "It may have been deleted on Meta. Refresh the table.");
    const data = await loadEditable(getDb(), input.level, input.id);
    return { ok: true, data: { ...data, currency: row.currency } };
  });
}

const editInput = z.object({
  name: z.string().max(400).optional(),
  endTime: z.iso.datetime({ offset: true }).nullable().optional(),
  bidAmount: z.number().int().positive().nullable().optional(),
  roasFloor: z.number().positive().max(1000).nullable().optional(),
  countries: z.array(z.string().regex(/^[A-Z]{2}$/)).min(1).max(250).optional(),
  ageMin: z.number().int().min(13).max(65).optional(),
  ageMax: z.number().int().min(13).max(65).optional(),
});

/** Ads Manager's edit pane: name, schedule, bid and audience; one change_log row with before, after and Meta's response. */
export async function editObjectAction(objectLevel: string, objectId: string, edit: z.infer<typeof editInput>) {
  return runAction(async () => {
    const session = await requireRole("owner", "admin", "buyer");
    const input = z.object({ level, id: z.uuid(), edit: editInput }).parse({ level: objectLevel, id: objectId, edit });
    await assertNotKilled();
    const readable = await asUser(session.userId, (tx) => tx.execute(sql`select 1 from ${sql.raw(MIRROR[input.level])} where id = ${input.id}`));
    if (!(readable as unknown as unknown[]).length) throw new UserError("Not found", "It may have been deleted on Meta. Refresh the table.");
    let skipped = false;
    const change = await logged(session.userId, input.level, input.id, "edit", async () => {
      const c = await editObject(getDb(), input.level, input.id, input.edit);
      skipped = Object.keys(c.after).length === 0;
      return c;
    });
    revalidatePath("/ads");
    return { ok: true, message: skipped ? "Nothing changed." : `Saved ${change.name}.` } satisfies ActionResult;
  });
}

/** The live ad's text, link and button, read from its creative on Meta. */
export async function loadAdCopyAction(adId: string): Promise<ActionResult<AdCopy>> {
  return runAction(async () => {
    const session = await requireRole("owner", "admin", "buyer");
    const id = z.uuid().parse(adId);
    const readable = await asUser(session.userId, (tx) => tx.execute(sql`select 1 from meta_ads where id = ${id}`));
    if (!(readable as unknown as unknown[]).length) throw new UserError("Not found", "It may have been deleted on Meta. Refresh the table.");
    return { ok: true, data: await loadAdCopy(getDb(), id) };
  });
}

const copyInput = z.object({
  primaryTexts: z.array(z.string().max(5000)).max(5),
  headlines: z.array(z.string().max(1000)).max(5),
  descriptions: z.array(z.string().max(1000)).max(5),
  link: z.url().max(2000),
  cta: z.string().regex(/^[A-Z_]+$/),
  urlTags: z.string().max(2000).nullable(),
});

/** Ads Manager's ad text edit: a new creative with the same media, swapped onto the ad; logged. */
export async function editAdCopyAction(adId: string, copy: z.infer<typeof copyInput>) {
  return runAction(async () => {
    const session = await requireRole("owner", "admin", "buyer");
    const input = z.object({ id: z.uuid(), copy: copyInput }).parse({ id: adId, copy });
    await assertNotKilled();
    const readable = await asUser(session.userId, (tx) => tx.execute(sql`select 1 from meta_ads where id = ${input.id}`));
    if (!(readable as unknown as unknown[]).length) throw new UserError("Not found", "It may have been deleted on Meta. Refresh the table.");
    const change = await logged(session.userId, "ad", input.id, "edit_creative", () => editAdCopy(getDb(), input.id, input.copy));
    revalidatePath("/ads");
    return { ok: true, message: Object.keys(change.after).length ? `Saved ${change.name}. Meta reviews the new text before it runs.` : "Nothing changed." } satisfies ActionResult;
  });
}

import { eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import * as s from "../src/schema";
import { SEED_USERS } from "../src/seed";
import { asServiceRole, asUser, createTestDb, type TestDb } from "./helpers";

const { owner, admin, buyer, viewer } = SEED_USERS;
const STRANGER = "00000000-0000-4000-8000-0000000000ff";
const DENIED = /row-level security|permission denied/;

let db: TestDb;
let firstAccountId: string;
let ownerDraftId: string;
let presetId: string;

beforeAll(async () => {
  db = await createTestDb();
  // A signed-up auth user who was never added to the team.
  await db.execute(sql`insert into auth.users (id, email) values (${STRANGER}, 'stranger@example.com')`);
  firstAccountId = (await db.select().from(s.adAccounts).limit(1))[0]!.id;
  ownerDraftId = (await db.select().from(s.launches).where(eq(s.launches.status, "draft")))[0]!.id;
  presetId = (await db.select().from(s.presets).limit(1))[0]!.id;
});

describe("schema", () => {
  it("creates all 20 tables with RLS enabled", async () => {
    const rows = await db.execute<{ relname: string; relrowsecurity: boolean }>(sql`
      select c.relname, c.relrowsecurity from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' order by 1`);
    expect(rows.rows).toHaveLength(20);
    expect(rows.rows.filter((r) => !r.relrowsecurity)).toEqual([]);
  });

  it("creates the four metric views as security invoker", async () => {
    const rows = await db.execute<{ relname: string; reloptions: string[] }>(sql`
      select c.relname, c.reloptions from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'v' order by 1`);
    expect(rows.rows.map((r) => r.relname)).toEqual([
      "account_insights_daily",
      "ad_insights_daily",
      "adset_insights_daily",
      "campaign_insights_daily",
    ]);
    for (const r of rows.rows) expect(r.reloptions).toContain("security_invoker=true");
  });
});

describe("membership", () => {
  it("lets every member read", async () => {
    for (const u of [owner, admin, buyer, viewer]) {
      const r = await asUser(db, u.id, (tx) => tx.select().from(s.brands));
      expect(r).toMatchObject({ ok: true });
      expect(r.ok && r.value).toHaveLength(2);
    }
  });

  it("shows nothing to signed-in users who are not on the team", async () => {
    const r = await asUser(db, STRANGER, async (tx) => ({
      brands: await tx.select().from(s.brands),
      insights: await tx.select().from(s.accountInsightsDaily),
      users: await tx.select().from(s.users),
    }));
    expect(r).toEqual({ ok: true, value: { brands: [], insights: [], users: [] } });
  });
});

describe("viewers", () => {
  it("cannot write anything (week 1 check)", async () => {
    const attempts = [
      (tx: Parameters<Parameters<typeof asUser>[2]>[0]) => tx.insert(s.brands).values({ name: "Nope" }),
      (tx: Parameters<Parameters<typeof asUser>[2]>[0]) =>
        tx.insert(s.launches).values({ name: "x", presetId, createdBy: viewer.id, mode: "new_campaign" }),
      (tx: Parameters<Parameters<typeof asUser>[2]>[0]) =>
        tx.insert(s.changeLog).values({ actorId: viewer.id, source: "ui", entityLevel: "ad", entityId: "1", action: "pause" }),
    ];
    for (const attempt of attempts) {
      const r = await asUser(db, viewer.id, attempt);
      expect(r.ok).toBe(false);
      expect(!r.ok && r.error).toMatch(DENIED);
    }
  });

  it("cannot change rows even where no error is raised", async () => {
    const r = await asUser(db, viewer.id, (tx) =>
      tx.update(s.brands).set({ defaultDomain: "x.example" }).returning({ id: s.brands.id }),
    );
    expect(r).toEqual({ ok: true, value: [] });
  });
});

describe("buyers", () => {
  it("edit brands, presets and creatives", async () => {
    const r = await asUser(db, buyer.id, async (tx) => {
      await tx.insert(s.brands).values({ name: "Cedar" });
      return tx.update(s.presets).set({ defaultCta: "LEARN_MORE" }).returning({ id: s.presets.id });
    });
    expect(r.ok && r.value).toHaveLength(3);
  });

  it("cannot change ad account guardrails", async () => {
    const r = await asUser(db, buyer.id, (tx) =>
      tx.update(s.adAccounts).set({ maxDailyBudget: 9_999_999 }).returning({ id: s.adAccounts.id }),
    );
    expect(r).toEqual({ ok: true, value: [] });
  });

  it("create drafts only as themselves", async () => {
    const own = await asUser(db, buyer.id, (tx) =>
      tx.insert(s.launches).values({ name: "mine", presetId, createdBy: buyer.id, mode: "new_campaign" }),
    );
    expect(own.ok).toBe(true);
    const spoofed = await asUser(db, buyer.id, (tx) =>
      tx.insert(s.launches).values({ name: "theirs", presetId, createdBy: owner.id, mode: "new_campaign" }),
    );
    expect(!spoofed.ok && spoofed.error).toMatch(DENIED);
    const notDraft = await asUser(db, buyer.id, (tx) =>
      tx.insert(s.launches).values({ name: "x", presetId, createdBy: buyer.id, mode: "new_campaign", status: "done" }),
    );
    expect(!notDraft.ok && notDraft.error).toMatch(DENIED);
  });

  it("cannot edit someone else's draft, but a manager can", async () => {
    const rename = (tx: Parameters<Parameters<typeof asUser>[2]>[0]) =>
      tx.update(s.launches).set({ name: "renamed" }).where(eq(s.launches.id, ownerDraftId)).returning({ id: s.launches.id });
    expect(await asUser(db, buyer.id, rename)).toEqual({ ok: true, value: [] });
    expect(await asUser(db, admin.id, rename)).toEqual({ ok: true, value: [{ id: ownerDraftId }] });
  });

  it("cannot touch launches once they leave draft", async () => {
    const r = await asUser(db, owner.id, (tx) =>
      tx.update(s.launches).set({ name: "x" }).where(eq(s.launches.status, "done")).returning({ id: s.launches.id }),
    );
    expect(r).toEqual({ ok: true, value: [] });
  });

  it("append change log rows only as themselves, from the UI or Claude", async () => {
    const row = { source: "ui" as const, entityLevel: "ad" as const, entityId: "1", action: "pause" };
    expect((await asUser(db, buyer.id, (tx) => tx.insert(s.changeLog).values({ ...row, actorId: buyer.id }))).ok).toBe(true);
    const spoofed = await asUser(db, buyer.id, (tx) => tx.insert(s.changeLog).values({ ...row, actorId: owner.id }));
    expect(!spoofed.ok && spoofed.error).toMatch(DENIED);
    const system = await asUser(db, buyer.id, (tx) =>
      tx.insert(s.changeLog).values({ ...row, actorId: buyer.id, source: "system" }),
    );
    expect(!system.ok && system.error).toMatch(DENIED);
  });
});

describe("guardrails and connections", () => {
  it("admins can set guardrails but no other ad account column", async () => {
    const guardrail = await asUser(db, admin.id, (tx) =>
      tx.update(s.adAccounts).set({ approvalThreshold: 50_000 }).where(eq(s.adAccounts.id, firstAccountId)).returning({ id: s.adAccounts.id }),
    );
    expect(guardrail).toEqual({ ok: true, value: [{ id: firstAccountId }] });
    const rename = await asUser(db, owner.id, (tx) =>
      tx.update(s.adAccounts).set({ name: "Renamed" }).where(eq(s.adAccounts.id, firstAccountId)),
    );
    expect(!rename.ok && rename.error).toMatch(/permission denied/);
  });

  it("never exposes token ciphertext, even to the owner", async () => {
    const secret = await asUser(db, owner.id, (tx) => tx.execute(sql`select token_ciphertext from meta_connections`));
    expect(!secret.ok && secret.error).toMatch(/permission denied/);
    const safe = await asUser(db, viewer.id, (tx) =>
      tx.select({ name: s.metaConnections.businessName, last4: s.metaConnections.tokenLast4 }).from(s.metaConnections),
    );
    expect(safe).toEqual({ ok: true, value: [{ name: "Fahd Holdings (seed)", last4: "SEED" }] });
  });

  it("only owners manage Meta connections", async () => {
    const row = {
      businessId: "100000000000009",
      businessName: "Second BM",
      tokenCiphertext: "x",
      tokenIv: "y",
      tokenLast4: "abcd",
    };
    const asAdmin = await asUser(db, admin.id, (tx) => tx.insert(s.metaConnections).values(row));
    expect(!asAdmin.ok && asAdmin.error).toMatch(DENIED);
    const asOwner = await asUser(db, owner.id, (tx) =>
      tx.insert(s.metaConnections).values(row).returning({ id: s.metaConnections.id }),
    );
    expect(asOwner.ok).toBe(true);
  });
});

describe("team", () => {
  it("admins manage the team but cannot create or touch owners", async () => {
    const promoteToAdmin = await asUser(db, admin.id, (tx) =>
      tx.update(s.users).set({ role: "admin" }).where(eq(s.users.id, buyer.id)).returning({ id: s.users.id }),
    );
    expect(promoteToAdmin).toEqual({ ok: true, value: [{ id: buyer.id }] });
    const promoteToOwner = await asUser(db, admin.id, (tx) =>
      tx.update(s.users).set({ role: "owner" }).where(eq(s.users.id, buyer.id)),
    );
    expect(!promoteToOwner.ok && promoteToOwner.error).toMatch(DENIED);
    const demoteOwner = await asUser(db, admin.id, (tx) =>
      tx.update(s.users).set({ role: "viewer" }).where(eq(s.users.id, owner.id)).returning({ id: s.users.id }),
    );
    expect(demoteOwner).toEqual({ ok: true, value: [] });
  });

  it("buyers cannot change roles", async () => {
    const r = await asUser(db, buyer.id, (tx) =>
      tx.update(s.users).set({ role: "owner" }).where(eq(s.users.id, buyer.id)).returning({ id: s.users.id }),
    );
    expect(r).toEqual({ ok: true, value: [] });
  });

  it("nobody can delete themselves", async () => {
    const r = await asUser(db, owner.id, (tx) =>
      tx.delete(s.users).where(eq(s.users.id, owner.id)).returning({ id: s.users.id }),
    );
    expect(r).toEqual({ ok: true, value: [] });
  });
});

describe("audit trail", () => {
  it("is append-only for every role, including the service role", async () => {
    const update = await asServiceRole(db, (tx) => tx.update(s.changeLog).set({ action: "edited" }));
    expect(!update.ok && update.error).toMatch(/append-only/);
    const del = await asServiceRole(db, (tx) => tx.delete(s.changeLog));
    expect(!del.ok && del.error).toMatch(/append-only/);
    const truncate = await asServiceRole(db, (tx) => tx.execute(sql`truncate change_log`));
    expect(truncate.ok).toBe(false);
  });
});

describe("saved views", () => {
  it("are private to their owner", async () => {
    const mine = await asUser(db, owner.id, (tx) => tx.select().from(s.savedViews));
    expect(mine.ok && mine.value).toHaveLength(1);
    const theirs = await asUser(db, buyer.id, (tx) => tx.select().from(s.savedViews));
    expect(theirs).toEqual({ ok: true, value: [] });
    const spoofed = await asUser(db, buyer.id, (tx) =>
      tx.insert(s.savedViews).values({ userId: owner.id, name: "x", level: "ad" }),
    );
    expect(!spoofed.ok && spoofed.error).toMatch(DENIED);
  });
});

describe("updated_at", () => {
  it("moves forward on update", async () => {
    const r = await asServiceRole(db, async (tx) => {
      const [before] = await tx.select().from(s.brands).limit(1);
      await tx.execute(sql`select pg_sleep(0.01)`);
      // now() is fixed per transaction, so compare against the stored value.
      const [after] = await tx
        .update(s.brands)
        .set({ defaultDomain: "changed.example" })
        .where(eq(s.brands.id, before!.id))
        .returning();
      return { before: before!.updatedAt, after: after!.updatedAt };
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.after.getTime()).toBeGreaterThanOrEqual(r.value.before.getTime());
  });
});

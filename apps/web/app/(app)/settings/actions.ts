"use server";

import { randomUUID } from "node:crypto";
import { checkToken, setKillSwitch, syncConnectionAssets, verifyConnection } from "@fahd/core";
import { adAccounts, changeLog, metaConnections, users } from "@fahd/db/schema";
import { encryptToken } from "@fahd/shared";
import { eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { parseMoneyInput } from "@/lib/format";
import { type ActionResult, runAction } from "@/lib/server/action-result";
import { authMode, requireRole } from "@/lib/server/auth";
import { asUser, getDb } from "@/lib/server/db";
import { supabaseAdmin } from "@/lib/server/supabase";

const businessId = z.string().trim().regex(/^\d{5,20}$/, "Business ID is the number in Business Settings → Business info.");
const token = z.string().trim().min(20, "Paste the full system user token.");

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

export async function addConnection(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const session = await requireRole("owner");
    const input = z.object({ businessId, token }).parse(Object.fromEntries(formData));
    const check = await checkToken(input.token, input.businessId);
    const enc = encryptToken(input.token);

    const id = await asUser(session.userId, async (tx) => {
      const [row] = await tx
        .insert(metaConnections)
        .values({
          businessId: input.businessId,
          businessName: check.businessName,
          tokenCiphertext: enc.ciphertext,
          tokenIv: enc.iv,
          tokenLast4: enc.last4,
          scopes: check.granted,
          status: check.missing.length ? "unverified" : "active",
          lastVerifiedAt: new Date(),
        })
        .returning({ id: metaConnections.id });
      await tx.insert(changeLog).values({
        actorId: session.userId,
        source: "ui",
        entityLevel: "meta_connection",
        entityId: row!.id,
        action: "connect",
        after: { businessId: input.businessId, businessName: check.businessName, scopes: check.granted },
      });
      return row!.id;
    });

    const summary = await syncConnectionAssets(getDb(), id);
    revalidatePath("/", "layout");
    const missing = check.missing.length ? ` Missing permissions: ${check.missing.join(", ")}.` : "";
    return {
      ok: true,
      message: `Connected ${check.businessName}: ${plural(summary.adAccounts, "ad account")}, ${plural(summary.pages, "page")}, ${plural(summary.pixels, "pixel")}.${missing}`,
    };
  });
}

export async function replaceToken(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const session = await requireRole("owner");
    const input = z.object({ connectionId: z.uuid(), token }).parse(Object.fromEntries(formData));
    const [existing] = await asUser(session.userId, (tx) =>
      tx.select({ businessId: metaConnections.businessId }).from(metaConnections).where(eq(metaConnections.id, input.connectionId)),
    );
    if (!existing) throw new Error("Connection not found");
    const check = await checkToken(input.token, existing.businessId);
    const enc = encryptToken(input.token);
    await asUser(session.userId, async (tx) => {
      await tx
        .update(metaConnections)
        .set({
          tokenCiphertext: enc.ciphertext,
          tokenIv: enc.iv,
          tokenLast4: enc.last4,
          scopes: check.granted,
          status: check.missing.length ? "unverified" : "active",
          lastVerifiedAt: new Date(),
        })
        .where(eq(metaConnections.id, input.connectionId));
      await tx.insert(changeLog).values({
        actorId: session.userId,
        source: "ui",
        entityLevel: "meta_connection",
        entityId: input.connectionId,
        action: "replace_token",
        after: { tokenLast4: enc.last4, scopes: check.granted },
      });
    });
    revalidatePath("/settings");
    return { ok: true, message: "Token replaced and verified." };
  });
}

export async function reverifyConnection(connectionId: string): Promise<ActionResult> {
  return runAction(async () => {
    await requireRole("owner");
    const check = await verifyConnection(getDb(), z.uuid().parse(connectionId));
    revalidatePath("/settings");
    return check.missing.length
      ? { ok: false, error: { title: "Permissions missing", detail: check.missing.join(", "), fix: "Regenerate the token with every permission ticked." } }
      : { ok: true, message: "Every required permission is granted." };
  });
}

export async function syncConnection(connectionId: string): Promise<ActionResult> {
  return runAction(async () => {
    await requireRole("owner", "admin");
    const summary = await syncConnectionAssets(getDb(), z.uuid().parse(connectionId));
    revalidatePath("/", "layout");
    return { ok: true, message: `Synced ${plural(summary.adAccounts, "ad account")}, ${plural(summary.pages, "page")}, ${plural(summary.instagram, "Instagram account")}, ${plural(summary.pixels, "pixel")}.` };
  });
}

export async function updateGuardrails(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const session = await requireRole("owner", "admin");
    const accountId = z.uuid().parse(formData.get("accountId"));
    return asUser(session.userId, async (tx) => {
      const [before] = await tx.select().from(adAccounts).where(eq(adAccounts.id, accountId));
      if (!before) throw new Error("Ad account not found");
      const money = (key: string) => {
        const raw = String(formData.get(key) ?? "");
        const minor = parseMoneyInput(raw, before.currency);
        if (raw.trim() && (minor === null || minor < 0)) throw new z.ZodError([{ code: "custom", path: [key], message: "Enter an amount, or leave it empty for no limit.", input: raw }]);
        return minor;
      };
      const after = {
        maxDailyBudget: money("maxDailyBudget"),
        approvalThreshold: money("approvalThreshold"),
        launchEnabled: formData.get("launchEnabled") === "on",
      };
      await tx.update(adAccounts).set(after).where(eq(adAccounts.id, accountId));
      await tx.insert(changeLog).values({
        actorId: session.userId,
        source: "ui",
        entityLevel: "ad_account",
        entityId: before.metaId,
        action: "update_guardrails",
        before: { maxDailyBudget: before.maxDailyBudget, approvalThreshold: before.approvalThreshold, launchEnabled: before.launchEnabled },
        after,
      });
      revalidatePath("/settings");
      return { ok: true, message: `Guardrails saved for ${before.name}.` };
    });
  });
}

const roleSchema = z.enum(["owner", "admin", "buyer", "viewer"]);

export async function inviteMember(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const session = await requireRole("owner", "admin");
    const input = z
      .object({ email: z.email("Enter a valid email."), name: z.string().trim().max(80).optional(), role: roleSchema })
      .parse(Object.fromEntries(formData));
    let id: string;
    if (authMode() === "supabase") {
      const { data, error } = await supabaseAdmin().auth.admin.inviteUserByEmail(input.email);
      if (error || !data.user) throw new Error(error?.message ?? "Supabase did not create the user");
      id = data.user.id;
    } else {
      id = randomUUID();
      await getDb().execute(sql`insert into auth.users (id, email) values (${id}, ${input.email})`);
    }
    await asUser(session.userId, (tx) => tx.insert(users).values({ id, email: input.email, name: input.name || null, role: input.role }));
    revalidatePath("/settings");
    return { ok: true, message: `Invited ${input.email} as ${input.role}.` };
  });
}

export async function changeRole(userId: string, role: string): Promise<ActionResult> {
  return runAction(async () => {
    const session = await requireRole("owner", "admin");
    const input = z.object({ userId: z.uuid(), role: roleSchema }).parse({ userId, role });
    if (input.userId === session.userId) return { ok: false, error: { title: "Not allowed", detail: "Ask another owner or admin to change your role." } };
    const updated = await asUser(session.userId, (tx) =>
      tx.update(users).set({ role: input.role }).where(eq(users.id, input.userId)).returning({ id: users.id }),
    );
    if (!updated.length) return { ok: false, error: { title: "Not allowed", detail: "Admins can't create owners or change an owner's role." } };
    revalidatePath("/settings");
    return { ok: true, message: "Role updated." };
  });
}

/**
 * Kill switch (owner only): the worker delays every job and running launches stop at
 * their next step; inline runs check the same flag. Pauses still go through.
 */
export async function setKillSwitchAction(on: boolean): Promise<ActionResult> {
  return runAction(async () => {
    const session = await requireRole("owner");
    const value = z.boolean().parse(on);
    await asUser(session.userId, async (tx) => {
      await setKillSwitch(tx, value, session.userId);
      await tx.insert(changeLog).values({ actorId: session.userId, source: "ui", entityLevel: "user", entityId: session.userId, action: value ? "kill_switch_on" : "kill_switch_off", after: { on: value } });
    });
    revalidatePath("/", "layout");
    return { ok: true, message: value ? "Kill switch on. Queues and launches are stopped." : "Kill switch off. Queues resume." };
  });
}

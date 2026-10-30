"use server";

import { activateLaunch, changeDailyBudget, changeStatus, checkSpend, type MetaChange } from "@fahd/core";
import { approvalRequests, changeLog } from "@fahd/db/schema";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { type ActionResult, UserError, runAction } from "@/lib/server/action-result";
import { requireRole } from "@/lib/server/auth";
import { asUser, getDb } from "@/lib/server/db";
import { GuardrailError, assertNotKilled } from "@/lib/server/guard";

/**
 * Approve runs the requested change as the approver, after checking the account
 * maximum again (spend may have moved since the request). Reject just closes it.
 */
export async function decideApproval(id: string, approve: boolean): Promise<ActionResult> {
  return runAction(async () => {
    const session = await requireRole("owner", "admin");
    const requestId = z.uuid().parse(id);
    const [req] = await getDb().select().from(approvalRequests).where(eq(approvalRequests.id, requestId));
    if (!req || req.status !== "pending") throw new UserError("Already decided", "Someone else approved or rejected this request.");
    const close = (status: "approved" | "rejected" | "failed", error: string | null = null) =>
      asUser(session.userId, (tx) =>
        tx
          .update(approvalRequests)
          .set({ status, decidedBy: session.userId, decidedAt: new Date(), error })
          .where(and(eq(approvalRequests.id, requestId), eq(approvalRequests.status, "pending"))),
      );

    if (!approve) {
      await close("rejected");
      revalidatePath("/approvals");
      return { ok: true, message: `Rejected: ${req.entityName}.` };
    }

    await assertNotKilled();
    const decision = await checkSpend(getDb(), { adAccountId: req.adAccountId, role: session.role, increase: req.increase });
    if (decision.decision === "block") throw new GuardrailError(decision);

    const note = { approvalRequestId: req.id, requestedBy: req.requestedBy };
    try {
      if (req.kind === "launch_activate") {
        await activateLaunch(getDb(), req.entityId, { actorId: session.userId, source: "ui" });
      } else {
        const level = req.entityLevel as "campaign" | "adset" | "ad";
        const change: MetaChange =
          req.kind === "activate"
            ? await changeStatus(getDb(), level, req.entityId, "ACTIVE")
            : await changeDailyBudget(getDb(), level as "campaign" | "adset", req.entityId, req.payload.dailyBudget!);
        await asUser(session.userId, (tx) =>
          tx.insert(changeLog).values({
            actorId: session.userId,
            source: "ui",
            entityLevel: level,
            entityId: change.metaId,
            action: req.kind === "activate" ? "activate" : "update_budget",
            before: change.before,
            after: { ...change.after, ...note },
            metaResponse: change.metaResponse as object,
          }),
        );
      }
    } catch (e) {
      if (req.kind !== "launch_activate") {
        await asUser(session.userId, (tx) =>
          tx.insert(changeLog).values({
            actorId: session.userId,
            source: "ui",
            entityLevel: req.entityLevel!,
            entityId: req.entityId,
            action: `${req.kind === "activate" ? "activate" : "update_budget"}_failed`,
            after: note,
            metaResponse: { message: e instanceof Error ? e.message : String(e) },
          }),
        );
      }
      await close("failed", e instanceof Error ? e.message.slice(0, 500) : String(e));
      revalidatePath("/approvals");
      throw e;
    }
    await close("approved");
    revalidatePath("/approvals");
    revalidatePath("/ads");
    return { ok: true, message: `Approved and applied: ${req.entityName}.` };
  });
}

import "server-only";
import { adAccounts, approvalRequests, users } from "@fahd/db/schema";
import { alias } from "drizzle-orm/pg-core";
import { desc, eq, sql } from "drizzle-orm";
import { asUser } from "./db";

export type ApprovalRow = {
  id: string;
  kind: "activate" | "budget" | "launch_activate";
  level: string | null;
  entityId: string;
  entityName: string;
  accountName: string;
  currency: string;
  requestedBy: string;
  decidedBy: string | null;
  status: "pending" | "approved" | "rejected" | "failed";
  increase: number;
  dailyBudget: number | null;
  before: number | null;
  error: string | null;
  createdAt: string;
  decidedAt: string | null;
};

export async function loadApprovals(userId: string): Promise<ApprovalRow[]> {
  const decider = alias(users, "decider");
  return asUser(userId, async (tx) => {
    const rows = await tx
      .select({
        r: approvalRequests,
        account: adAccounts.name,
        currency: adAccounts.currency,
        by: sql<string>`coalesce(${users.name}, ${users.email})`,
        decidedBy: sql<string | null>`coalesce(${decider.name}, ${decider.email})`,
      })
      .from(approvalRequests)
      .innerJoin(adAccounts, eq(adAccounts.id, approvalRequests.adAccountId))
      .innerJoin(users, eq(users.id, approvalRequests.requestedBy))
      .leftJoin(decider, eq(decider.id, approvalRequests.decidedBy))
      .orderBy(sql`${approvalRequests.status} = 'pending' desc`, desc(approvalRequests.createdAt))
      .limit(100);
    return rows.map(({ r, ...x }) => ({
      id: r.id,
      kind: r.kind,
      level: r.entityLevel,
      entityId: r.entityId,
      entityName: r.entityName,
      accountName: x.account,
      currency: x.currency,
      requestedBy: x.by,
      decidedBy: x.decidedBy,
      status: r.status,
      increase: r.increase,
      dailyBudget: r.payload.dailyBudget ?? null,
      before: r.payload.before ?? null,
      error: r.error,
      createdAt: r.createdAt.toISOString(),
      decidedAt: r.decidedAt?.toISOString() ?? null,
    }));
  });
}

export async function pendingApprovals(userId: string) {
  return asUser(userId, async (tx) => tx.$count(approvalRequests, eq(approvalRequests.status, "pending")));
}

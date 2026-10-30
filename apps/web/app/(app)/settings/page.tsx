import type { Metadata } from "next";
import { adAccounts, apiUsage, appSettings, metaAssets, metaConnections, users } from "@fahd/db/schema";
import { REQUIRED_PERMISSIONS } from "@fahd/meta";
import { asc, count, desc, eq } from "drizzle-orm";
import { PageHeader } from "@/components/page-header";
import { requireSession } from "@/lib/server/auth";
import { asUser } from "@/lib/server/db";
import { AccountsSection, ConnectionsSection, KillSwitchSection, SettingsNav, TeamSection, UsageSection } from "./sections";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const session = await requireSession();
  const data = await asUser(session.userId, async (tx) => {
    const connections = await tx
      .select({
        id: metaConnections.id,
        businessId: metaConnections.businessId,
        businessName: metaConnections.businessName,
        tokenLast4: metaConnections.tokenLast4,
        scopes: metaConnections.scopes,
        status: metaConnections.status,
        lastVerifiedAt: metaConnections.lastVerifiedAt,
      })
      .from(metaConnections)
      .orderBy(asc(metaConnections.createdAt));
    const assets = await tx
      .select({ connectionId: metaAssets.connectionId, kind: metaAssets.kind, n: count() })
      .from(metaAssets)
      .groupBy(metaAssets.connectionId, metaAssets.kind);
    const accounts = await tx.select().from(adAccounts).orderBy(asc(adAccounts.name));
    const members = await tx.select().from(users).orderBy(asc(users.email));
    const usage = await tx
      .selectDistinctOn([apiUsage.adAccountId], { adAccountId: apiUsage.adAccountId, pct: apiUsage.accUtilPct, at: apiUsage.recordedAt, tier: apiUsage.tier })
      .from(apiUsage)
      .orderBy(apiUsage.adAccountId, desc(apiUsage.recordedAt));
    const [kill] = await tx.select().from(appSettings).where(eq(appSettings.key, "kill_switch"));
    return { connections, assets, accounts, members, usage, kill };
  });

  const role = session.role;
  const accountsByConnection = new Map<string, number>();
  for (const a of data.accounts) accountsByConnection.set(a.connectionId, (accountsByConnection.get(a.connectionId) ?? 0) + 1);

  return (
    <>
      <PageHeader title="Settings" description="Meta connections, guardrails, team and API usage." />
      <div className="grid gap-8 lg:grid-cols-[180px_minmax(0,1fr)]">
        <SettingsNav />
        <div className="grid max-w-4xl min-w-0 gap-6">
          <ConnectionsSection
            canManage={role === "owner"}
            canSync={role === "owner" || role === "admin"}
            required={[...REQUIRED_PERMISSIONS]}
            connections={data.connections.map((c) => ({
              ...c,
              lastVerifiedAt: c.lastVerifiedAt?.toISOString() ?? null,
              adAccounts: accountsByConnection.get(c.id) ?? 0,
              assets: Object.fromEntries(data.assets.filter((a) => a.connectionId === c.id).map((a) => [a.kind, a.n])),
            }))}
          />
          <AccountsSection
            canEdit={role === "owner" || role === "admin"}
            accounts={data.accounts.map((a) => ({
              id: a.id,
              metaId: a.metaId,
              name: a.name,
              currency: a.currency,
              timezone: a.timezone,
              accountStatus: a.accountStatus,
              maxDailyBudget: a.maxDailyBudget,
              approvalThreshold: a.approvalThreshold,
              launchEnabled: a.launchEnabled,
            }))}
          />
          <KillSwitchSection on={Boolean((data.kill?.value as { on?: boolean } | undefined)?.on)} since={data.kill?.updatedAt.toISOString() ?? null} canFlip={role === "owner"} />
          <TeamSection
            canManage={role === "owner" || role === "admin"}
            canCreateOwners={role === "owner"}
            currentUserId={session.userId}
            members={data.members.map((m) => ({ id: m.id, name: m.name, email: m.email, role: m.role }))}
          />
          <UsageSection
            rows={data.accounts.map((a) => {
              const u = data.usage.find((x) => x.adAccountId === a.id);
              return { id: a.id, name: a.name, pct: u?.pct ?? null, at: u?.at.toISOString() ?? null, tier: u?.tier ?? null };
            })}
          />
        </div>
      </div>
    </>
  );
}

export const dynamic = "force-dynamic";

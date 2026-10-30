import type { Metadata } from "next";
import { ShieldCheck } from "lucide-react";
import { ApprovalsView } from "@/components/approvals/approvals-view";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { loadApprovals } from "@/lib/server/approvals";
import { requireSession } from "@/lib/server/auth";

export const metadata: Metadata = { title: "Approvals" };

export default async function ApprovalsPage() {
  const session = await requireSession();
  const rows = await loadApprovals(session.userId);
  return (
    <>
      <PageHeader title="Approvals" description="Buyers' spend increases above an account's approval threshold wait here for an owner or admin." />
      {rows.length === 0 ? (
        <EmptyState icon={ShieldCheck} title="Nothing to approve" description="When a buyer's change adds more daily spend than the account's approval threshold, it shows up here." />
      ) : (
        <ApprovalsView rows={rows} canDecide={session.role === "owner" || session.role === "admin"} />
      )}
    </>
  );
}

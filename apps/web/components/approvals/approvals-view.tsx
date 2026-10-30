"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { decideApproval } from "@/app/(app)/approvals/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TimeAgo } from "@/components/ui/time-ago";
import { formatMoney } from "@/lib/format";
import type { ApprovalRow } from "@/lib/server/approvals";

const LEVEL = { campaign: "campaign", adset: "ad set", ad: "ad" } as Record<string, string>;
const STATUS = {
  pending: { tone: "warning", label: "Waiting" },
  approved: { tone: "positive", label: "Approved" },
  rejected: { tone: "neutral", label: "Rejected" },
  failed: { tone: "negative", label: "Failed" },
} as const;

function describe(r: ApprovalRow) {
  if (r.kind === "launch_activate") return `Activate launch ${r.entityName}`;
  if (r.kind === "activate") return `Activate ${LEVEL[r.level ?? ""] ?? ""} ${r.entityName}`;
  return `Budget for ${r.entityName}: ${formatMoney(r.before, r.currency, { compact: false })} → ${formatMoney(r.dailyBudget, r.currency, { compact: false })}/day`;
}

export function ApprovalsView({ rows, canDecide }: { rows: ApprovalRow[]; canDecide: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState<string | null>(null);

  async function decide(id: string, approve: boolean) {
    setBusy(id);
    const res = await decideApproval(id, approve);
    setBusy(null);
    if (res.ok) toast.success(res.message ?? "Done");
    else toast.error(res.error.title, { description: [res.error.detail, res.error.fix].filter(Boolean).join(" ") });
    router.refresh();
  }

  return (
    <div className="overflow-hidden rounded-card border border-slate-6">
      <table className="w-full text-ui">
        <thead className="bg-slate-2 text-label text-slate-11">
          <tr className="h-8 text-left">
            <th className="px-3 font-medium">Change</th>
            <th className="w-36 px-3 font-medium">Account</th>
            <th className="w-32 px-3 font-medium">Asked by</th>
            <th className="w-32 px-3 text-right font-medium">Adds per day</th>
            <th className="w-48 px-3 text-right font-medium">
              <span className="sr-only">Decision</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const s = STATUS[r.status];
            return (
              <tr key={r.id} className="h-10 border-t border-slate-6 align-middle">
                <td className="max-w-0 px-3 py-2">
                  <p className="truncate font-medium">{describe(r)}</p>
                  {r.error && <p className="truncate text-label text-red-11">{r.error}</p>}
                </td>
                <td className="truncate px-3 text-slate-11">{r.accountName}</td>
                <td className="px-3 text-slate-11">
                  <span className="block truncate">{r.requestedBy}</span>
                  <TimeAgo iso={r.createdAt} className="text-label" />
                </td>
                <td className="px-3 text-right tabular-nums">{formatMoney(r.increase, r.currency, { compact: false })}</td>
                <td className="px-3 text-right">
                  {r.status === "pending" && canDecide ? (
                    <span className="inline-flex gap-2">
                      <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => decide(r.id, false)} aria-label={`Reject: ${describe(r)}`}>
                        Reject
                      </Button>
                      <Button size="sm" variant="primary" disabled={busy !== null} onClick={() => decide(r.id, true)} aria-label={`Approve: ${describe(r)}`}>
                        {busy === r.id ? "Applying…" : "Approve"}
                      </Button>
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-2">
                      <Badge tone={s.tone}>{s.label}</Badge>
                      {r.decidedBy && <span className="text-label text-slate-11">by {r.decidedBy}</span>}
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

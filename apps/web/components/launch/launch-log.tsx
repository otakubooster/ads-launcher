"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, CircleAlert, Copy, Loader2, Minus } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatRelativeTime } from "@/lib/format";
import type { LaunchLog, LogItem } from "@/lib/server/launches";
import { cn } from "@/lib/utils";
import type { UserRole } from "@fahd/db/schema";

const LEVEL = { campaign: "Campaign", adset: "Ad set", creative: "Creative", ad: "Ad" } as const;
const INDENT = { campaign: "pl-3", adset: "pl-9", creative: "pl-15", ad: "pl-15" } as const;

export function statusPill(log: Pick<LaunchLog, "status" | "items">) {
  const objects = log.items.filter((i) => i.level !== "creative");
  const done = objects.filter((i) => i.status === "done").length;
  switch (log.status) {
    case "queued":
      return { tone: "neutral" as const, label: "Queued" };
    case "running":
      return { tone: "info" as const, label: `Running ${done}/${objects.length}` };
    case "done":
      return { tone: "positive" as const, label: "Done" };
    case "partial":
      return { tone: "warning" as const, label: "Partial" };
    case "failed":
      return { tone: "negative" as const, label: "Failed" };
    default:
      return { tone: "neutral" as const, label: "Draft" };
  }
}

function StatusIcon({ status }: { status: LogItem["status"] }) {
  if (status === "done") return <Check className="size-4 text-grass-11" aria-label="Created" />;
  if (status === "failed") return <CircleAlert className="size-4 text-red-11" aria-label="Failed" />;
  if (status === "running") return <Loader2 className="size-4 animate-spin text-blue-11 motion-reduce:animate-none" aria-label="Creating" />;
  return <Minus className="size-4 text-slate-9" aria-label="Waiting" />;
}

/** Depth-first order: campaign → ad sets → (creative, ad) pairs. Creatives fold into their ad's row. */
function ordered(items: LogItem[]) {
  const children = new Map<string | null, LogItem[]>();
  for (const i of items) children.set(i.parentId, [...(children.get(i.parentId) ?? []), i]);
  const out: LogItem[] = [];
  const walk = (parent: string | null) => {
    for (const i of children.get(parent) ?? []) {
      if (i.level !== "creative") out.push(i);
      walk(i.id);
    }
  };
  walk(null);
  return out;
}

export function LaunchLogView({ log }: { log: LaunchLog; role: UserRole }) {
  const router = useRouter();
  const live = log.status === "queued" || log.status === "running";

  // Live progress: re-read every 2 s while the runner works.
  React.useEffect(() => {
    if (!live) return;
    const t = setInterval(() => router.refresh(), 2000);
    return () => clearInterval(t);
  }, [live, router]);

  const pill = statusPill(log);
  const rows = ordered(log.items);
  // A creative's failure shows on the ad that uses it.
  const creativeOf = new Map(log.items.filter((i) => i.level === "creative").map((c) => [c.parentId, c]));

  return (
    <>
      <PageHeader
        title={log.name}
        description={`${log.preset} · started by ${log.by} ${formatRelativeTime(new Date(log.createdAt))}${log.activateAfter ? " · activates when done" : " · created paused"}`}
        actions={
          <>
            <Badge tone={pill.tone} data-testid="launch-status">
              {pill.label}
            </Badge>
            <Button asChild variant="ghost">
              <Link href="/launches">All launches</Link>
            </Button>
          </>
        }
      />
      <ul className="overflow-hidden rounded-card border border-slate-6" aria-label="Launch items">
        {rows.map((i) => {
          const creative = i.level === "ad" ? [...creativeOf.values()].find((c) => c.parentId === i.parentId && c.name === i.name) : undefined;
          const error = i.errorMessage ?? (creative?.status === "failed" ? creative.errorMessage : null);
          const failed = i.status === "failed" || creative?.status === "failed";
          return (
            <li key={i.id} className={cn("border-b border-slate-6 py-2 pr-3 text-ui last:border-0", INDENT[i.level])}>
              <div className="flex min-h-6 items-center gap-2">
                <StatusIcon status={failed ? "failed" : i.status} />
                <span className="w-16 shrink-0 text-label text-slate-11">{LEVEL[i.level]}</span>
                <span className="min-w-0 flex-1 truncate font-medium">{i.name}</span>
                {i.metaId && (
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded-control px-1.5 font-mono text-label text-slate-11 hover:bg-slate-3 hover:text-slate-12"
                    aria-label={`Copy Meta ID ${i.metaId}`}
                    onClick={() => void navigator.clipboard.writeText(i.metaId!).then(() => toast.success("Meta ID copied"))}
                  >
                    {i.metaId} <Copy className="size-3" />
                  </button>
                )}
              </div>
              {error && (failed || i.status !== "done") && <p className={cn("mt-1 pl-6 text-label", failed ? "text-red-11" : "text-slate-11")}>{error}</p>}
            </li>
          );
        })}
      </ul>
    </>
  );
}

"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, CircleAlert, Copy, CopyPlus, Loader2, Minus, Play, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { activateAll, duplicateLaunch, retryFailedItems } from "@/app/(app)/launches/actions";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/kbd";
import { formatRelativeTime } from "@/lib/format";
import type { ActionResult } from "@/lib/server/action-result";
import type { LaunchLog, LogItem } from "@/lib/server/launches";
import { cn } from "@/lib/utils";
import type { UserRole } from "@fahd/db/schema";

const LEVEL = { campaign: "Campaign", adset: "Ad set", creative: "Creative", ad: "Ad" } as const;
const DEPTH = { campaign: 0, adset: 1, creative: 2, ad: 2 } as const;

export type PillTone = "neutral" | "info" | "positive" | "warning" | "negative";

/** "Running 34/48", "Done", "Partial", "Failed" (docs/spec.md → Launch log). */
export function statusPill(status: LaunchLog["status"], done: number, total: number): { tone: PillTone; label: string } {
  switch (status) {
    case "queued":
      return { tone: "neutral", label: "Queued" };
    case "running":
      return { tone: "info", label: `Running ${done}/${total}` };
    case "done":
      return { tone: "positive", label: "Done" };
    case "partial":
      return { tone: "warning", label: "Partial" };
    case "failed":
      return { tone: "negative", label: "Failed" };
    default:
      return { tone: "neutral", label: "Draft" };
  }
}

/** Re-reads the page every 2 s while `live`: the runner writes item status as it goes. */
export function useLiveRefresh(live: boolean) {
  const router = useRouter();
  React.useEffect(() => {
    if (!live) return;
    const t = setInterval(() => router.refresh(), 2000);
    return () => clearInterval(t);
  }, [live, router]);
}

function StatusIcon({ status }: { status: LogItem["status"] }) {
  if (status === "done") return <Check className="size-4 shrink-0 text-grass-11" aria-label="Created" />;
  if (status === "failed") return <CircleAlert className="size-4 shrink-0 text-red-11" aria-label="Failed" />;
  if (status === "running") return <Loader2 className="size-4 shrink-0 animate-spin text-blue-11 motion-reduce:animate-none" aria-label="Creating" />;
  return <Minus className="size-4 shrink-0 text-slate-9" aria-label="Waiting" />;
}

/** Depth-first: campaign → ad sets → ads. An ad hangs off its creative; the creative folds into the ad's row. */
function ordered(items: LogItem[]) {
  const children = new Map<string | null, LogItem[]>();
  for (const i of items) children.set(i.parentId, [...(children.get(i.parentId) ?? []), i]);
  const out: { item: LogItem; creative?: LogItem }[] = [];
  const walk = (parent: string | null, creative?: LogItem) => {
    for (const i of children.get(parent) ?? []) {
      if (i.level === "creative") {
        walk(i.id, i);
        continue;
      }
      out.push({ item: i, creative: i.level === "ad" ? creative : undefined });
      walk(i.id);
    }
  };
  walk(null);
  return out;
}

/** Runner errors are "title\ndetail\nfix" for Meta errors, one line otherwise. */
function ErrorText({ message, failed }: { message: string; failed: boolean }) {
  const [title, detail, fix] = message.split("\n");
  if (!failed) return <p className="text-label text-slate-11">{message}</p>;
  return (
    <div className="grid gap-0.5 text-label">
      <p className="font-medium text-red-11">{title}</p>
      {detail && <p className="text-slate-12">{detail}</p>}
      {fix && (
        <p className="text-slate-11">
          <span className="font-medium">Fix:</span> {fix}
        </p>
      )}
    </div>
  );
}

function report(res: ActionResult) {
  if (res.ok) toast.success(res.message ?? "Done");
  else toast.error(res.error.title, { description: [res.error.detail, res.error.fix].filter(Boolean).join(" ") });
}

export function LaunchLogView({ log, role }: { log: LaunchLog; role: UserRole }) {
  const router = useRouter();
  const live = log.status === "queued" || log.status === "running";
  useLiveRefresh(live);
  const [busy, setBusy] = React.useState<null | "retry" | "activate" | "duplicate">(null);
  const [confirm, setConfirm] = React.useState(false);

  const rows = ordered(log.items);
  const objects = log.items.filter((i) => i.level !== "creative");
  const done = objects.filter((i) => i.status === "done").length;
  // A failed creative always fails its ad too, so objects alone give the count people expect.
  const failed = objects.filter((i) => i.status === "failed").length;
  const ads = log.items.filter((i) => i.level === "ad");
  const pill = statusPill(log.status, done, objects.length);
  const canEdit = role !== "viewer";
  const allDone = log.items.length > 0 && log.items.every((i) => i.status === "done");

  async function run(kind: "retry" | "activate", fn: () => Promise<ActionResult>) {
    setBusy(kind);
    const res = await fn();
    setBusy(null);
    setConfirm(false);
    report(res);
    router.refresh();
  }

  return (
    <>
      <PageHeader
        title={log.name}
        description={`${log.preset} · started by ${log.by} ${formatRelativeTime(new Date(log.createdAt))} · ${
          log.activatedAt ? `activated ${formatRelativeTime(new Date(log.activatedAt))}` : log.activateAfter ? "activates when done" : "created paused"
        }`}
        actions={
          <>
            <Badge tone={pill.tone} data-testid="launch-status">
              {pill.label}
            </Badge>
            {canEdit && failed > 0 && !live && (
              <Button disabled={busy !== null} onClick={() => run("retry", () => retryFailedItems(log.id))}>
                <RotateCcw /> {busy === "retry" ? "Retrying…" : "Retry failed items"}
              </Button>
            )}
            {canEdit && allDone && !log.activatedAt && (
              <Button disabled={busy !== null} onClick={() => setConfirm(true)}>
                <Play /> Activate all
              </Button>
            )}
            {canEdit && (
              <Button
                variant="ghost"
                disabled={busy !== null}
                onClick={() => {
                  setBusy("duplicate");
                  void duplicateLaunch(log.id).catch(() => setBusy(null));
                }}
              >
                <CopyPlus /> Duplicate
              </Button>
            )}
          </>
        }
      />

      <p className="mb-3 text-ui text-slate-11 tabular-nums" aria-live="polite">
        {done} of {objects.length} created · {ads.filter((a) => a.status === "done").length} of {ads.length} ads
        {failed > 0 && <span className="text-red-11"> · {failed} failed</span>}
      </p>

      {rows.length === 0 ? (
        <p className="rounded-card border border-slate-6 px-4 py-6 text-body text-slate-11">This launch has no items.</p>
      ) : (
        <ul className="overflow-hidden rounded-card border border-slate-6" aria-label="Launch items">
          {rows.map(({ item: i, creative }) => {
            const isFailed = i.status === "failed" || creative?.status === "failed";
            const message = i.errorMessage ?? (creative?.status === "failed" ? creative.errorMessage : null);
            return (
              <li key={i.id} className={cn("border-b border-slate-6 py-2 pr-3 last:border-0", isFailed && "bg-red-2")}>
                <div className="flex min-h-6 items-center gap-2 text-ui" style={{ paddingLeft: 12 + DEPTH[i.level] * 24 }}>
                  <StatusIcon status={isFailed ? "failed" : creative && creative.status !== "done" && i.status === "pending" ? creative.status : i.status} />
                  <span className="min-w-0 flex-1 truncate">
                    <span className="mr-2 text-label text-slate-11">{LEVEL[i.level]}</span>
                    <span className="font-medium">{i.name}</span>
                  </span>
                  {i.attempts > 1 && <span className="text-label text-slate-11">{i.attempts} attempts</span>}
                  {i.metaId && (
                    <button
                      type="button"
                      className="inline-flex h-7 items-center gap-1 rounded-control px-1.5 font-mono text-label text-slate-11 hover:bg-slate-3 hover:text-slate-12"
                      aria-label={`Copy Meta ID ${i.metaId}`}
                      onClick={() => void navigator.clipboard.writeText(i.metaId!).then(() => toast.success("Meta ID copied"))}
                    >
                      {i.metaId} <Copy className="size-3" />
                    </button>
                  )}
                </div>
                {message && (isFailed || i.status !== "done") && (
                  <div className="mt-1" style={{ paddingLeft: 12 + DEPTH[i.level] * 24 + 24 }}>
                    <ErrorText message={message} failed={isFailed} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent
          className="max-w-md"
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void run("activate", () => activateAll(log.id));
          }}
        >
          <DialogHeader>
            <DialogTitle>Activate this launch?</DialogTitle>
            <DialogDescription>
              Turns on {ads.length} {ads.length === 1 ? "ad" : "ads"} and the ad sets and campaign this launch created. Spend starts right away on their budgets.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 px-5 pb-5">
            <Button variant="ghost" onClick={() => setConfirm(false)}>
              Cancel
            </Button>
            <Button variant="primary" disabled={busy !== null} onClick={() => run("activate", () => activateAll(log.id))}>
              {busy === "activate" ? "Activating…" : "Activate all"} <Kbd className="ml-1">⌘↵</Kbd>
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function LaunchList({ rows }: { rows: import("@/lib/server/launches").LaunchListRow[] }) {
  useLiveRefresh(rows.some((r) => r.status === "queued" || r.status === "running"));
  return (
    <div className="overflow-hidden rounded-card border border-slate-6">
      <table className="w-full text-ui">
        <thead className="bg-slate-2 text-label text-slate-11">
          <tr className="h-8 text-left">
            <th className="px-3 font-medium">Launch</th>
            <th className="w-36 px-3 font-medium">Preset</th>
            <th className="w-36 px-3 font-medium">Who</th>
            <th className="w-32 px-3 font-medium">When</th>
            <th className="w-36 px-3 font-medium">Status</th>
            <th className="w-28 px-3 text-right font-medium">Ads</th>
            <th className="w-24 px-3 text-right font-medium">Failed</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const pill = statusPill(r.status, r.done, r.total);
            return (
              <tr key={r.id} className="relative h-10 border-t border-slate-6 hover:bg-slate-2">
                <td className="max-w-0 truncate px-3 font-medium">
                  <Link href={`/launches/${r.id}`} className="after:absolute after:inset-0 focus-visible:outline-none">
                    {r.name}
                  </Link>
                </td>
                <td className="truncate px-3 text-slate-11">{r.preset}</td>
                <td className="truncate px-3 text-slate-11">{r.by}</td>
                <td className="px-3 text-slate-11">{formatRelativeTime(new Date(r.createdAt))}</td>
                <td className="px-3">
                  <Badge tone={pill.tone}>{pill.label}</Badge>
                </td>
                <td className="px-3 text-right tabular-nums">{r.ads}</td>
                <td className={cn("px-3 text-right tabular-nums", r.failed ? "text-red-11" : "text-slate-11")}>{r.failed}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

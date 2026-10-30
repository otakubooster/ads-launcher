"use client";

import * as React from "react";
import { ChevronRight, CircleAlert, Folder, FolderOpen, Megaphone, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { submitLaunch } from "@/app/(app)/launch/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/kbd";
import { formatMoney } from "@/lib/format";
import type { CreativeItem } from "@/lib/server/creatives";
import { cn } from "@/lib/utils";
import { planHasErrors, type LaunchPlan, type PlanIssue, type PlannedAd } from "@fahd/shared/launch-plan";
import type { UserRole } from "@fahd/db/schema";
import type { StepProps } from "./builder";
import { PhonePreview, type Placement } from "./phone-preview";

function Issues({ issues }: { issues: PlanIssue[] }) {
  if (!issues.length) return null;
  return (
    <ul className="grid gap-0.5">
      {issues.map((i) => (
        <li key={i.message} className={cn("flex items-center gap-1 text-label", i.level === "error" ? "text-red-11" : "text-amber-11")}>
          {i.level === "error" ? <CircleAlert className="size-3" /> : <TriangleAlert className="size-3" />}
          {i.message}
        </li>
      ))}
    </ul>
  );
}

export function ReviewStep({ data, library, plan }: StepProps) {
  const byId = React.useMemo(() => new Map(library.map((c) => [c.id, c])), [library]);
  const firstAd = plan.adsets[0]?.ads[0];
  const [selected, setSelected] = React.useState<string | null>(firstAd?.key ?? null);
  const ad: PlannedAd | undefined = plan.adsets.flatMap((a) => a.ads).find((a) => a.key === selected) ?? firstAd;
  const files = ad ? ad.group.creativeIds.map((id) => byId.get(id)).filter((c): c is CreativeItem => Boolean(c)) : [];
  const currency = data.preset.currency;

  return (
    <div className="grid gap-6">
      {plan.issues.length > 0 && (
        <div className="rounded-card border border-slate-6 px-4 py-3">
          <Issues issues={plan.issues} />
        </div>
      )}

      <div className="grid gap-6">
        <div className="overflow-hidden rounded-card border border-slate-6" role="tree" aria-label="Objects to create">
          <div role="treeitem" aria-expanded="true" aria-selected={false} className="flex h-10 items-center gap-2 bg-slate-2 px-3 text-ui">
            <Megaphone className="size-4 text-slate-11" />
            <span className="min-w-0 flex-1 truncate font-medium">{plan.campaign.name}</span>
            <Badge tone={plan.campaign.source === "new" ? "accent" : "neutral"}>{plan.campaign.source === "new" ? "New campaign" : "Existing"}</Badge>
            {plan.campaign.dailyBudget !== null && <span className="text-slate-11 tabular-nums">{formatMoney(plan.campaign.dailyBudget, currency, { compact: false })}/day</span>}
          </div>
          {plan.adsets.length === 0 && <p className="border-t border-slate-6 px-3 py-6 text-center text-ui text-slate-11">Nothing to create yet. Add creatives first.</p>}
          {plan.adsets.map((a) => (
            <div key={a.key} role="group" className="border-t border-slate-6">
              <div className="flex h-10 items-center gap-2 pr-3 pl-7 text-ui">
                <FolderOpen className="size-4 text-slate-11" />
                <span className="min-w-0 flex-1 truncate font-medium">{a.name}</span>
                <Badge tone={a.source === "existing" ? "neutral" : "accent"}>{a.source === "existing" ? "Existing" : a.source === "clone" ? "Copy of live ad set" : "New ad set"}</Badge>
                <span className="text-slate-11 tabular-nums">
                  {a.ads.length} {a.ads.length === 1 ? "ad" : "ads"}
                  {a.dailyBudget !== null && ` · ${formatMoney(a.dailyBudget, currency, { compact: false })}/day`}
                </span>
              </div>
              <ul>
                {a.ads.map((x) => {
                  const lead = byId.get(x.group.creativeIds[0] ?? "");
                  const hasError = x.issues.some((i) => i.level === "error");
                  return (
                    <li key={x.key} role="treeitem" aria-selected={ad?.key === x.key}>
                      <button
                        type="button"
                        onClick={() => setSelected(x.key)}
                        className={cn("flex w-full items-start gap-3 border-t border-slate-6 py-2 pr-3 pl-12 text-left text-ui", ad?.key === x.key ? "bg-iris-2" : "hover:bg-slate-2")}
                      >
                        <span className="size-10 shrink-0 overflow-hidden rounded-control bg-slate-3">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          {lead && <img src={lead.previewUrl} alt="" className="size-full object-cover" />}
                        </span>
                        <span className="grid min-w-0 flex-1 gap-0.5">
                          <span className="flex items-center gap-2">
                            <span className="truncate font-medium">{x.name}</span>
                            {hasError && <span className="sr-only">Has errors</span>}
                          </span>
                          <span className="truncate text-label text-slate-11">
                            {x.placements.map((p) => `${p.ratio ?? "?"} → ${p.placements}`).join(" · ") || "Existing post"}
                          </span>
                          <span className="truncate text-label text-slate-11">
                            {x.copy.primaryTexts.length} {x.copy.primaryTexts.length === 1 ? "text" : "texts"} · {x.copy.headlines.length} {x.copy.headlines.length === 1 ? "headline" : "headlines"} · {x.copy.cta.toLowerCase().replace(/_/g, " ")}
                          </span>
                          <Issues issues={x.issues} />
                        </span>
                        <ChevronRight className="mt-3 size-4 shrink-0 text-slate-9" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>

        <aside aria-label="Placement previews" className="grid content-start gap-3">
          {ad ? (
            <>
              <p className="truncate text-label font-medium text-slate-11">Preview · {ad.name}</p>
              <div className="flex flex-wrap justify-start gap-4">
                {(["reels", "feed", "stories"] as Placement[]).map((p) => (
                  <PhonePreview key={p} placement={p} files={files} copy={ad.copy} pageName={data.preset.pageName} />
                ))}
              </div>
            </>
          ) : (
            <p className="flex items-center gap-2 text-ui text-slate-11">
              <Folder className="size-4" /> Previews appear once there are ads.
            </p>
          )}
        </aside>
      </div>

    </div>
  );
}

/** Create paused (primary) and, for owners and admins, Create & activate behind a confirm. */
export function CreateButtons({ plan, role, launchId, currency, accountName }: { plan: LaunchPlan; role: UserRole; launchId: string; currency: string; accountName: string }) {
  const [confirm, setConfirm] = React.useState(false);
  const [busy, setBusy] = React.useState<"paused" | "active" | null>(null);
  const blocked = planHasErrors(plan) || plan.totals.ads === 0;
  const canActivate = role === "owner" || role === "admin";

  async function create(activate: boolean) {
    setBusy(activate ? "active" : "paused");
    const res = await submitLaunch(launchId, { activate });
    // On success the action redirects to the launch log.
    setBusy(null);
    if (res && !res.ok) toast.error(res.error.title, { description: res.error.detail });
  }

  return (
    <>
      <Button variant="primary" disabled={blocked || busy !== null} onClick={() => create(false)}>
        {busy === "paused" ? "Creating…" : "Create paused"}
      </Button>
      {canActivate && (
        <Button disabled={blocked || busy !== null} onClick={() => setConfirm(true)}>
          Create &amp; activate
        </Button>
      )}
      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent
          className="max-w-md"
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void create(true);
          }}
        >
          <DialogHeader>
            <DialogTitle>Create and activate?</DialogTitle>
            <DialogDescription>
              Everything is created paused first, then activated once all {plan.totals.ads} ads exist. This starts spending
              {plan.totals.dailyBudget > 0 ? ` up to ${formatMoney(plan.totals.dailyBudget, currency, { compact: false })} a day` : " on the existing budgets"} in {accountName}.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 px-5 pb-5">
            <Button variant="ghost" onClick={() => setConfirm(false)}>
              Cancel
            </Button>
            <Button variant="primary" disabled={busy !== null} onClick={() => create(true)}>
              {busy === "active" ? "Creating…" : "Create & activate"} <Kbd className="ml-1">⌘↵</Kbd>
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

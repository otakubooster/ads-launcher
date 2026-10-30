"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Check, CircleAlert, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { changePreset, deleteDraft, saveDraft } from "@/app/(app)/launch/actions";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm";
import { LocalTime } from "@/components/ui/time-ago";
import type { UserRole as Role } from "@fahd/db/schema";
import type { CreativeItem } from "@/lib/server/creatives";
import type { BuilderData } from "@/lib/server/launch";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { buildPlan, type LaunchDraft, type LaunchPlan, type PlanContext } from "@fahd/shared/launch-plan";
import { CopyStep } from "./copy-step";
import { CreativesStep } from "./creatives-step";
import { DestinationStep } from "./destination-step";
import { CreateButtons, ReviewStep } from "./review-step";
import { StructureStep } from "./structure-step";

export type Update = (fn: (d: LaunchDraft) => LaunchDraft) => void;
export type StepProps = { data: BuilderData; library: CreativeItem[]; draft: LaunchDraft; update: Update; plan: LaunchPlan; role: Role };

const STEPS = [
  { key: "destination", label: "Destination" },
  { key: "creatives", label: "Creatives" },
  { key: "copy", label: "Copy" },
  { key: "structure", label: "Structure & naming" },
  { key: "review", label: "Review" },
] as const;
type StepKey = (typeof STEPS)[number]["key"];

/** The same context the server builds in planContext(), from data already on the page. */
export function contextFor(data: BuilderData, library: CreativeItem[], draft: LaunchDraft): PlanContext {
  const d = draft.destination;
  const campaign = data.campaigns.find((c) => c.id === d.campaignId);
  const clone = data.adsets.find((a) => a.id === d.cloneAdsetId);
  return {
    brand: data.preset.brandName,
    market: data.preset.market,
    date: data.preset.today,
    currency: data.preset.currency,
    creatives: Object.fromEntries(library.map((c) => [c.id, { ratio: c.ratio, kind: c.kind, fileName: c.fileName }])),
    existingCampaign: campaign ? { metaId: campaign.metaId, name: campaign.name, hasBudget: campaign.dailyBudget !== null } : null,
    existingAdsets: data.adsets.filter((a) => d.adsetIds?.includes(a.id)).map((a) => ({ id: a.id, metaId: a.metaId, name: a.name })),
    cloneAdset: clone ? { metaId: clone.metaId, name: clone.name } : null,
  };
}

/** Which step each top-level problem belongs to, for the stepper's markers. */
function stepIssues(plan: LaunchPlan): Record<StepKey, number> {
  const out: Record<StepKey, number> = { destination: 0, creatives: 0, copy: 0, structure: 0, review: 0 };
  for (const i of plan.issues.filter((x) => x.level === "error")) {
    if (/creative/i.test(i.message)) out.creatives++;
    else if (/link/i.test(i.message)) out.copy++;
    else if (/start time/i.test(i.message)) out.structure++;
    else out.destination++;
  }
  for (const a of plan.adsets) for (const ad of a.ads) for (const i of ad.issues) if (i.level === "error") out[/text/i.test(i.message) ? "copy" : "creatives"]++;
  return out;
}

export function LaunchBuilder({ data, library, role }: { data: BuilderData; library: CreativeItem[]; role: Role }) {
  const router = useRouter();
  const [draft, setDraft] = React.useState(data.launch.draft);
  const [name, setName] = React.useState(data.launch.name);
  const [step, setStep] = React.useState<StepKey>("destination");
  const [save, setSave] = React.useState<"saved" | "saving" | "error">("saved");
  const [switching, setSwitching] = React.useState(false);
  const dirty = React.useRef(false);

  const update: Update = React.useCallback((fn) => {
    dirty.current = true;
    setDraft((d) => fn(d));
  }, []);

  // Autosave: every change, 600 ms after the last edit.
  React.useEffect(() => {
    if (!dirty.current) return;
    setSave("saving");
    const t = setTimeout(async () => {
      const res = await saveDraft(data.launch.id, { name: name.trim() || data.launch.name, presetId: data.preset.id, structure: draft });
      setSave(res.ok ? "saved" : "error");
      if (!res.ok) toast.error(res.error.title, { description: res.error.detail });
    }, 600);
    return () => clearTimeout(t);
  }, [draft, name, data.launch.id, data.launch.name, data.preset.id]);

  const plan = React.useMemo(() => buildPlan(draft, contextFor(data, library, draft)), [draft, data, library]);
  const issues = stepIssues(plan);
  const index = STEPS.findIndex((s) => s.key === step);
  const props: StepProps = { data, library, draft, update, plan, role };

  async function onPreset(presetId: string) {
    setSwitching(true);
    const res = await changePreset(data.launch.id, presetId);
    setSwitching(false);
    if (!res.ok) return toast.error(res.error.title, { description: res.error.detail });
    toast.success(res.message ?? "Preset changed");
    router.refresh();
  }

  return (
    <div className="grid grid-cols-[176px_minmax(0,1fr)_256px] items-start gap-6">
      <nav aria-label="Launch steps" className="sticky top-6 grid gap-0.5">
        <ol className="grid gap-0.5">
          {STEPS.map((s, i) => (
            <li key={s.key}>
              <button
                type="button"
                onClick={() => setStep(s.key)}
                aria-current={step === s.key ? "step" : undefined}
                className={cn(
                  "flex h-9 w-full items-center gap-2.5 rounded-control px-2 text-left text-ui transition-colors",
                  step === s.key ? "bg-slate-4 font-medium text-slate-12" : "text-slate-11 hover:bg-slate-3 hover:text-slate-12",
                )}
              >
                <span
                  className={cn(
                    "flex size-5 shrink-0 items-center justify-center rounded-full border text-label tabular-nums",
                    step === s.key ? "border-iris-9 bg-iris-9 text-white" : i < index ? "border-iris-8 text-iris-11" : "border-slate-7",
                  )}
                >
                  {i < index && step !== s.key ? <Check className="size-3" /> : i + 1}
                </span>
                <span className="flex-1">{s.label}</span>
                {issues[s.key] > 0 && s.key !== "review" && <CircleAlert className="size-3.5 text-red-11" aria-label={`${issues[s.key]} to fix`} />}
              </button>
            </li>
          ))}
        </ol>
      </nav>

      <section aria-labelledby="step-title" className="min-w-0">
        <div className="mb-5 flex items-center gap-3">
          <h2 id="step-title" className="text-section font-semibold">
            {STEPS[index]!.label}
          </h2>
          <span className="text-label text-slate-11" aria-live="polite">
            {save === "saving" ? "Saving…" : save === "error" ? "Not saved" : "Draft saved"}
          </span>
        </div>

        {step === "destination" && (
          <DestinationStep {...props} name={name} onName={(n) => ((dirty.current = true), setName(n))} onPreset={onPreset} switching={switching} />
        )}
        {step === "creatives" && <CreativesStep {...props} />}
        {step === "copy" && <CopyStep {...props} />}
        {step === "structure" && <StructureStep {...props} />}
        {step === "review" && <ReviewStep {...props} />}

        <div className="mt-8 flex items-center justify-between border-t border-slate-6 pt-4">
          <Button variant="ghost" disabled={index === 0} onClick={() => setStep(STEPS[index - 1]!.key)}>
            Back
          </Button>
          {index < STEPS.length - 1 && (
            <Button variant="primary" onClick={() => setStep(STEPS[index + 1]!.key)}>
              Next: {STEPS[index + 1]!.label}
            </Button>
          )}
        </div>
      </section>

      <Summary plan={plan} currency={data.preset.currency} data={data} draft={draft} onReview={step === "review" ? null : () => setStep("review")} launchId={data.launch.id} role={role} />
    </div>
  );
}

function Summary({
  plan,
  currency,
  data,
  draft,
  onReview,
  launchId,
  role,
}: {
  plan: LaunchPlan;
  currency: string;
  data: BuilderData;
  draft: LaunchDraft;
  /** Null on the Review step, where the create buttons take its place. */
  onReview: (() => void) | null;
  launchId: string;
  role: Role;
}) {
  const router = useRouter();
  const { confirm, dialog } = useConfirm();
  const errors = plan.issues.filter((i) => i.level === "error").length + plan.adsets.reduce((n, a) => n + a.ads.reduce((m, ad) => m + ad.issues.filter((i) => i.level === "error").length, 0), 0);
  return (
    <aside aria-label="Launch summary" className="sticky top-6 grid gap-4 rounded-card border border-slate-6 p-4">
      <div>
        <p className="text-label text-slate-11">This launch creates</p>
        <p className="mt-1 text-body font-medium tabular-nums" data-testid="launch-summary">
          {plan.totals.ads} {plan.totals.ads === 1 ? "ad" : "ads"} · {plan.totals.adsets} {plan.totals.adsets === 1 ? "ad set" : "ad sets"}
          {plan.totals.dailyBudget > 0 && <> · {formatMoney(plan.totals.dailyBudget, currency, { compact: false })}/day</>} · created paused
        </p>
      </div>
      <dl className="grid grid-cols-[72px_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-ui">
        <dt className="text-slate-11">Account</dt>
        <dd className="truncate">{data.preset.accountName}</dd>
        <dt className="text-slate-11">Page</dt>
        <dd className="truncate">{data.preset.pageName}</dd>
        <dt className="text-slate-11">Pixel</dt>
        <dd className="truncate">
          {data.preset.pixelName} · {data.preset.conversionEvent.toLowerCase().replace(/_/g, " ")}
        </dd>
        <dt className="text-slate-11">Start</dt>
        <dd>{draft.structure.start === "scheduled" && draft.structure.startTime ? <LocalTime iso={draft.structure.startTime} /> : "Paused"}</dd>
      </dl>
      {errors > 0 ? (
        <p className="flex items-center gap-1.5 text-ui text-red-11">
          <CircleAlert className="size-3.5" />
          {errors} {errors === 1 ? "thing" : "things"} to fix before launching
        </p>
      ) : (
        <p className="flex items-center gap-1.5 text-ui text-grass-11">
          <Check className="size-3.5" />
          Ready to review
        </p>
      )}
      {onReview ? (
        <Button variant="primary" onClick={onReview}>
          Review launch
        </Button>
      ) : (
        <CreateButtons plan={plan} role={role} launchId={launchId} currency={currency} accountName={data.preset.accountName} />
      )}
      <Button
        variant="ghost"
        size="sm"
        className="justify-self-start text-slate-11"
        onClick={async () => {
          if (!(await confirm({ title: "Delete this draft?", description: "Its settings are lost. Nothing was created on Meta.", confirmLabel: "Delete draft", destructive: true }))) return;
          const res = await deleteDraft(launchId);
          if (!res.ok) return toast.error(res.error.title, { description: res.error.detail });
          toast.success("Draft deleted");
          router.push("/launch");
        }}
      >
        <Trash2 /> Delete draft
      </Button>
      {dialog}
    </aside>
  );
}

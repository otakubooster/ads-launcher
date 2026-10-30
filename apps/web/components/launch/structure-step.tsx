"use client";

import * as React from "react";
import { Field, Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { CREATIVE_FEATURES } from "@fahd/shared/meta-options";
import { NAMING_TOKENS, unknownTokens } from "@fahd/shared/naming";
import type { GroupingMode } from "@fahd/shared/launch-plan";
import type { StepProps } from "./builder";

const GROUPINGS: { value: GroupingMode; label: string; hint: string }[] = [
  { value: "per_angle", label: "One ad set per angle", hint: "Creatives sharing an angle compete together" },
  { value: "per_creative", label: "One ad set per creative", hint: "Clean test, more ad sets" },
  { value: "all_in_one", label: "All in one ad set", hint: "Meta picks the winners" },
  { value: "n_per_adset", label: "N ads per ad set", hint: "Fixed-size batches in upload order" },
];

/** datetime-local wants "YYYY-MM-DDTHH:mm" in local time. */
function toLocalInput(iso: string | null | undefined) {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function StructureStep({ draft, update, plan }: StepProps) {
  const s = draft.structure;
  const set = (patch: Partial<typeof s>) => update((d) => ({ ...d, structure: { ...d.structure, ...patch } }));
  const existingAdsets = draft.destination.mode === "existing_adset";
  const examples = {
    campaign: plan.campaign.source === "new" ? plan.campaign.name : null,
    adset: plan.adsets.find((a) => a.source !== "existing")?.name ?? null,
    ad: plan.adsets[0]?.ads[0]?.name ?? null,
  };

  return (
    <div className="grid max-w-2xl gap-8">
      {!existingAdsets && (
        <fieldset className="grid gap-2">
          <legend className="mb-2 text-label font-medium text-slate-11">Ad set grouping</legend>
          <div className="grid grid-cols-2 gap-2">
            {GROUPINGS.map((g) => (
              <label
                key={g.value}
                className={cn(
                  "grid cursor-default gap-0.5 rounded-card border px-3 py-2.5 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-iris-8",
                  s.grouping === g.value ? "border-iris-8 bg-iris-2" : "border-slate-6 hover:bg-slate-2",
                )}
              >
                <input type="radio" name="grouping" className="sr-only" checked={s.grouping === g.value} onChange={() => set({ grouping: g.value })} />
                <span className="text-ui font-medium">{g.label}</span>
                <span className="text-label text-slate-11">{g.hint}</span>
              </label>
            ))}
          </div>
          {s.grouping === "n_per_adset" && (
            <Field label="Ads per ad set" htmlFor="per-adset" className="mt-2 w-40">
              <Input id="per-adset" type="number" min={1} max={50} value={s.perAdset} onChange={(e) => set({ perAdset: Math.min(50, Math.max(1, Number(e.target.value) || 1)) })} />
            </Field>
          )}
          <p className="text-ui text-slate-11 tabular-nums">
            {plan.totals.adsets} {plan.totals.adsets === 1 ? "ad set" : "ad sets"} · {plan.totals.ads} {plan.totals.ads === 1 ? "ad" : "ads"}
          </p>
        </fieldset>
      )}

      <fieldset className="grid gap-3">
        <legend className="mb-1 text-label font-medium text-slate-11">
          Naming <span className="font-normal">· tokens: {NAMING_TOKENS.map((t) => `{${t}}`).join(" ")}</span>
        </legend>
        {(["campaign", "adset", "ad"] as const)
          .filter((level) => (level === "campaign" ? draft.destination.mode === "new_campaign" : level === "adset" ? !existingAdsets : true))
          .map((level) => {
            const bad = unknownTokens(s.naming[level]);
            return (
              <Field key={level} label={level === "adset" ? "Ad set" : level === "ad" ? "Ad" : "Campaign"} htmlFor={`naming-${level}`}>
                <Input
                  id={`naming-${level}`}
                  className="font-mono"
                  value={s.naming[level]}
                  aria-invalid={bad.length > 0 || undefined}
                  onChange={(e) => set({ naming: { ...s.naming, [level]: e.target.value } })}
                />
                {bad.length > 0 ? (
                  <p className="text-label text-red-11">Unknown token: {bad.map((t) => `{${t}}`).join(", ")}</p>
                ) : (
                  examples[level] && <p className="truncate font-mono text-label text-slate-11">→ {examples[level]}</p>
                )}
              </Field>
            );
          })}
      </fieldset>

      <fieldset className="grid gap-1">
        <legend className="mb-2 text-label font-medium text-slate-11">Advantage+ creative <span className="font-normal">· defaults from the preset</span></legend>
        <ul className="grid grid-cols-2 gap-x-6">
          {CREATIVE_FEATURES.map((f) => (
            <li key={f.key} className="flex h-10 items-center justify-between gap-3 border-b border-slate-6 text-ui">
              <label htmlFor={`feature-${f.key}`} className="min-w-0">
                <span className="block truncate">{f.label}</span>
              </label>
              <Switch
                id={`feature-${f.key}`}
                checked={s.features[f.key] === "OPT_IN"}
                onCheckedChange={(on) => set({ features: { ...s.features, [f.key]: on ? "OPT_IN" : "OPT_OUT" } })}
              />
            </li>
          ))}
        </ul>
      </fieldset>

      <fieldset className="grid gap-2">
        <legend className="mb-2 text-label font-medium text-slate-11">Start</legend>
        <div className="flex flex-wrap items-center gap-4 text-ui">
          <label className="flex items-center gap-2">
            <input type="radio" name="start" className="accent-iris-9" checked={s.start === "paused"} onChange={() => set({ start: "paused", startTime: null })} />
            Paused <span className="text-slate-11">(default: activate when you&apos;re ready)</span>
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="start" className="accent-iris-9" checked={s.start === "scheduled"} onChange={() => set({ start: "scheduled" })} />
            Scheduled
          </label>
          {s.start === "scheduled" && (
            <Input
              type="datetime-local"
              aria-label="Start time"
              className="w-56"
              value={toLocalInput(s.startTime)}
              onChange={(e) => set({ startTime: e.target.value ? new Date(e.target.value).toISOString() : null })}
            />
          )}
        </div>
        {s.start === "scheduled" && <p className="text-label text-slate-11">Ad sets get this start time. Everything is still created paused; activate the launch to let it start on schedule.</p>}
      </fieldset>
    </div>
  );
}

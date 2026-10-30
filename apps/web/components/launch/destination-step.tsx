"use client";

import * as React from "react";
import { Field, Input, NativeSelect } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { formatMoney, moneyInputValue, parseMoneyInput } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { LaunchMode } from "@fahd/shared/launch-plan";
import type { StepProps } from "./builder";

const MODES: { value: LaunchMode; label: string; hint: string }[] = [
  { value: "new_campaign", label: "New campaign", hint: "A campaign with new ad sets from a template" },
  { value: "existing_campaign", label: "New ad sets in a campaign", hint: "Add ad sets to a live campaign" },
  { value: "existing_adset", label: "Existing ad sets", hint: "Add ads to ad sets that already run" },
];

export function DestinationStep({
  data,
  draft,
  update,
  name,
  onName,
  onPreset,
  switching,
}: StepProps & { name: string; onName: (n: string) => void; onPreset: (id: string) => void; switching: boolean }) {
  const d = draft.destination;
  const currency = data.preset.currency;
  const [budget, setBudget] = React.useState(moneyInputValue(d.dailyBudget || null, currency));
  const [adsetQuery, setAdsetQuery] = React.useState("");
  const set = (patch: Partial<typeof d>) => update((x) => ({ ...x, destination: { ...x.destination, ...patch } }));
  const campaign = data.campaigns.find((c) => c.id === d.campaignId);
  const campaignHasBudget = campaign ? campaign.dailyBudget !== null : false;
  const adsets = data.adsets.filter((a) => a.name.toLowerCase().includes(adsetQuery.toLowerCase())).slice(0, 50);

  return (
    <div className="grid max-w-2xl gap-6">
      <div className="grid grid-cols-2 gap-4">
        <Field label="Launch name" htmlFor="launch-name">
          <Input id="launch-name" value={name} maxLength={120} onChange={(e) => onName(e.target.value)} />
        </Field>
        <Field label="Preset" htmlFor="launch-preset" hint="Brand × market: fills account, page, Instagram, pixel, link and UTMs.">
          <NativeSelect id="launch-preset" value={data.preset.id} disabled={switching} onChange={(e) => onPreset(e.target.value)}>
            {data.presets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </div>

      <dl className="grid grid-cols-[120px_minmax(0,1fr)] gap-x-4 gap-y-1.5 rounded-card border border-slate-6 bg-slate-2 px-4 py-3 text-ui">
        <dt className="text-slate-11">Ad account</dt>
        <dd>
          {data.preset.accountName} · {currency}
        </dd>
        <dt className="text-slate-11">Facebook page</dt>
        <dd>{data.preset.pageName}</dd>
        <dt className="text-slate-11">Instagram</dt>
        <dd>{data.preset.instagramName ?? "Uses the page"}</dd>
        <dt className="text-slate-11">Pixel</dt>
        <dd>{data.preset.pixelName}</dd>
        <dt className="text-slate-11">Link</dt>
        <dd className="truncate">{data.preset.linkUrl}</dd>
        <dt className="text-slate-11">UTMs</dt>
        <dd className="truncate font-mono text-label">{data.preset.urlTags || "—"}</dd>
      </dl>

      <fieldset className="grid gap-2">
        <legend className="mb-2 text-label font-medium text-slate-11">Where the ads go</legend>
        <div className="grid grid-cols-3 gap-2">
          {MODES.map((m) => (
            <label
              key={m.value}
              className={cn(
                "grid cursor-default gap-0.5 rounded-card border px-3 py-2.5 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-iris-8",
                d.mode === m.value ? "border-iris-8 bg-iris-2" : "border-slate-6 hover:bg-slate-2",
              )}
            >
              <input type="radio" name="mode" value={m.value} checked={d.mode === m.value} onChange={() => set({ mode: m.value })} className="sr-only" />
              <span className="text-ui font-medium">{m.label}</span>
              <span className="text-label text-slate-11">{m.hint}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {d.mode === "existing_campaign" && (
        <Field label="Campaign" htmlFor="dest-campaign" hint={campaign && campaignHasBudget ? "This campaign has its own budget (CBO): new ad sets share it." : undefined}>
          <NativeSelect id="dest-campaign" value={d.campaignId ?? ""} onChange={(e) => set({ campaignId: e.target.value || null })}>
            <option value="">Pick a campaign…</option>
            {data.campaigns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} · {c.status.toLowerCase()}
                {c.dailyBudget !== null ? ` · ${formatMoney(c.dailyBudget, currency, { compact: false })}/day` : ""}
              </option>
            ))}
          </NativeSelect>
        </Field>
      )}

      {d.mode === "existing_adset" && (
        <div className="grid gap-2">
          <Field label="Ad sets" htmlFor="dest-adset-search" hint="Every creative becomes an ad in each ad set you pick.">
            <Input id="dest-adset-search" placeholder="Search ad sets" value={adsetQuery} onChange={(e) => setAdsetQuery(e.target.value)} />
          </Field>
          <ul className="grid max-h-64 overflow-y-auto rounded-card border border-slate-6" aria-label="Ad sets">
            {adsets.length === 0 && <li className="px-3 py-3 text-ui text-slate-11">No ad sets in this account match.</li>}
            {adsets.map((a) => {
              const on = d.adsetIds?.includes(a.id) ?? false;
              return (
                <li key={a.id} className="border-b border-slate-6 last:border-0">
                  <label className="flex h-10 items-center gap-3 px-3 text-ui hover:bg-slate-2">
                    <Checkbox
                      checked={on}
                      onChange={() => set({ adsetIds: on ? (d.adsetIds ?? []).filter((x) => x !== a.id) : [...(d.adsetIds ?? []), a.id] })}
                    />
                    <span className="min-w-0 flex-1 truncate">{a.name}</span>
                    <span className="text-label text-slate-11">{a.status.toLowerCase()}</span>
                  </label>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {d.mode !== "existing_adset" && (
        <div className="grid grid-cols-2 gap-4">
          <Field label="Ad set settings from" htmlFor="dest-template" hint="Targeting, optimisation and placements for new ad sets.">
            <NativeSelect
              id="dest-template"
              value={d.cloneAdsetId ? `clone:${d.cloneAdsetId}` : (d.adsetTemplateId ?? "")}
              onChange={(e) => {
                const v = e.target.value;
                if (v.startsWith("clone:")) set({ cloneAdsetId: v.slice(6), adsetTemplateId: null });
                else set({ adsetTemplateId: v || null, cloneAdsetId: null });
              }}
            >
              <option value="">Meta defaults (broad, Advantage+ audience)</option>
              <optgroup label="Ad set templates">
                {data.adsetTemplates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Copy a live ad set">
                {data.adsets.map((a) => (
                  <option key={a.id} value={`clone:${a.id}`}>
                    {a.name}
                  </option>
                ))}
              </optgroup>
            </NativeSelect>
          </Field>
          <Field label="Countries" htmlFor="dest-countries" hint="Two-letter codes, comma separated.">
            <Input
              id="dest-countries"
              value={d.countries.join(", ")}
              onChange={(e) =>
                set({
                  countries: e.target.value
                    .split(/[,\s]+/)
                    .map((c) => c.trim().toUpperCase())
                    .filter((c) => /^[A-Z]{1,2}$/.test(c)),
                })
              }
            />
          </Field>
        </div>
      )}

      {d.mode !== "existing_adset" && !(d.mode === "existing_campaign" && campaignHasBudget) && (
        <div className="grid grid-cols-2 gap-4">
          {d.mode === "new_campaign" && (
            <fieldset className="grid gap-1.5">
              <legend className="mb-1.5 text-label font-medium text-slate-11">Budget</legend>
              <div className="inline-flex h-8 rounded-control border border-slate-7 p-0.5">
                {(["campaign", "adset"] as const).map((t) => (
                  <label
                    key={t}
                    className={cn(
                      "flex flex-1 items-center justify-center rounded-[4px] px-2 text-ui has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-iris-8",
                      d.budgetType === t ? "bg-slate-4 font-medium" : "text-slate-11",
                    )}
                  >
                    <input type="radio" name="budget-type" className="sr-only" checked={d.budgetType === t} onChange={() => set({ budgetType: t })} />
                    {t === "campaign" ? "Campaign (CBO)" : "Per ad set (ABO)"}
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          <Field
            label={d.mode === "new_campaign" && d.budgetType === "campaign" ? "Daily budget" : "Daily budget per ad set"}
            htmlFor="dest-budget"
            hint={`In ${currency}.`}
          >
            <Input
              id="dest-budget"
              inputMode="decimal"
              className="tabular-nums"
              value={budget}
              onChange={(e) => {
                setBudget(e.target.value);
                set({ dailyBudget: parseMoneyInput(e.target.value, currency) ?? 0 });
              }}
            />
          </Field>
        </div>
      )}
    </div>
  );
}

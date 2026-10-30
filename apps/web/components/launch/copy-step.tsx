"use client";

import * as React from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, NativeSelect, Textarea } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { COPY_LIMITS, CTA_TYPES, label } from "@fahd/shared/meta-options";
import type { CopyBlock } from "@fahd/shared/launch-plan";
import type { StepProps } from "./builder";
import { PhonePreview } from "./phone-preview";

type ListKey = "primaryTexts" | "headlines" | "descriptions";
const LISTS: { key: ListKey; label: string; limit: number; multiline: boolean }[] = [
  { key: "primaryTexts", label: "Primary text", limit: COPY_LIMITS.primaryText, multiline: true },
  { key: "headlines", label: "Headline", limit: COPY_LIMITS.headline, multiline: false },
  { key: "descriptions", label: "Description", limit: COPY_LIMITS.description, multiline: false },
];

function Counter({ value, limit }: { value: string; limit: number }) {
  return <span className={cn("text-label tabular-nums", value.length > limit ? "text-amber-11" : "text-slate-11")}>{value.length}/{limit}</span>;
}

export function CopyStep({ data, library, draft, update }: StepProps) {
  const copy = draft.copy;
  const set = (patch: Partial<typeof copy>) => update((d) => ({ ...d, copy: { ...d.copy, ...patch } }));
  const setOverride = (key: string, patch: Partial<CopyBlock>) =>
    update((d) => {
      const next = { ...d.copy.overrides[key], ...patch };
      const empty = Object.values(next).every((v) => (Array.isArray(v) ? !v.some(Boolean) : !v));
      const overrides = { ...d.copy.overrides };
      if (empty) delete overrides[key];
      else overrides[key] = next;
      return { ...d, copy: { ...d.copy, overrides } };
    });
  const first = draft.creatives.groups[0];
  const files = first ? first.creativeIds.map((id) => library.find((c) => c.id === id)).filter((c) => c !== undefined) : [];

  function applySet(id: string) {
    const s = data.copySets.find((c) => c.id === id);
    if (!s) return set({ copySetId: null });
    set({
      copySetId: s.id,
      primaryTexts: s.primaryTexts.length ? s.primaryTexts : [""],
      headlines: s.headlines.length ? s.headlines : [""],
      descriptions: s.descriptions,
      cta: s.ctaType,
    });
  }

  return (
    <div className="grid gap-8 2xl:grid-cols-[minmax(0,1fr)_220px]">
      <div className="grid content-start gap-6">
        <Field label="Copy set" htmlFor="copy-set" hint="Fills the texts below. Edits here stay with this launch.">
          <NativeSelect id="copy-set" value={copy.copySetId ?? ""} onChange={(e) => applySet(e.target.value)}>
            <option value="">Write copy for this launch</option>
            {data.copySets.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} · {s.language}
              </option>
            ))}
          </NativeSelect>
        </Field>

        {LISTS.map((l) => {
          const values = copy[l.key].length ? copy[l.key] : l.key === "descriptions" ? [] : [""];
          return (
            <fieldset key={l.key} className="grid gap-2">
              <legend className="mb-2 text-label font-medium text-slate-11">
                {l.label} <span className="font-normal">· up to {COPY_LIMITS.perType}</span>
              </legend>
              {values.map((v, i) => {
                const id = `${l.key}-${i}`;
                const onChange = (value: string) => set({ [l.key]: values.map((x, j) => (j === i ? value : x)) } as Partial<typeof copy>);
                return (
                  <div key={i} className="flex items-start gap-2">
                    <div className="grid flex-1 gap-1">
                      {l.multiline ? (
                        <Textarea id={id} aria-label={`${l.label} ${i + 1}`} value={v} rows={3} onChange={(e) => onChange(e.target.value)} />
                      ) : (
                        <Input id={id} aria-label={`${l.label} ${i + 1}`} value={v} onChange={(e) => onChange(e.target.value)} />
                      )}
                      <span className="justify-self-end">
                        <Counter value={v} limit={l.limit} />
                      </span>
                    </div>
                    {(values.length > 1 || l.key === "descriptions") && (
                      <Button variant="ghost" size="icon-sm" aria-label={`Remove ${l.label.toLowerCase()} ${i + 1}`} onClick={() => set({ [l.key]: values.filter((_, j) => j !== i) } as Partial<typeof copy>)}>
                        <X />
                      </Button>
                    )}
                  </div>
                );
              })}
              {values.length < COPY_LIMITS.perType && (
                <Button variant="ghost" size="sm" className="justify-self-start" onClick={() => set({ [l.key]: [...values, ""] } as Partial<typeof copy>)}>
                  <Plus /> Add {l.label.toLowerCase()}
                </Button>
              )}
            </fieldset>
          );
        })}

        <div className="grid grid-cols-[180px_minmax(0,1fr)] gap-4">
          <Field label="Call to action" htmlFor="copy-cta">
            <NativeSelect id="copy-cta" value={copy.cta} onChange={(e) => set({ cta: e.target.value })}>
              {CTA_TYPES.map((c) => (
                <option key={c} value={c}>
                  {label(c)}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Link" htmlFor="copy-link" hint={data.preset.urlTags ? "The preset's UTMs are added to every ad." : undefined}>
            <Input id="copy-link" type="url" value={copy.link} onChange={(e) => set({ link: e.target.value })} aria-invalid={!copy.link || undefined} />
          </Field>
        </div>

        {draft.creatives.groups.length > 1 && (
          <section className="grid gap-2" aria-labelledby="overrides-title">
            <h3 id="overrides-title" className="text-label font-medium text-slate-11">
              Per creative <span className="font-normal">· leave empty to use the copy above</span>
            </h3>
            <div className="overflow-hidden rounded-card border border-slate-6">
              <table className="w-full text-ui">
                <thead className="bg-slate-2 text-label text-slate-11">
                  <tr className="h-8 text-left">
                    <th className="w-40 px-3 font-medium">Creative</th>
                    <th className="px-3 font-medium">Primary text</th>
                    <th className="w-56 px-3 font-medium">Headline</th>
                  </tr>
                </thead>
                <tbody>
                  {draft.creatives.groups.map((g) => {
                    const o = copy.overrides[g.key] ?? {};
                    return (
                      <tr key={g.key} className="h-10 border-t border-slate-6">
                        <td className="truncate px-3 font-medium">{g.key}</td>
                        <td className="px-3 py-1.5">
                          <Input aria-label={`Primary text for ${g.key}`} placeholder={copy.primaryTexts[0] || "Primary text"} value={o.primaryTexts?.[0] ?? ""} onChange={(e) => setOverride(g.key, { primaryTexts: e.target.value ? [e.target.value] : [] })} />
                        </td>
                        <td className="px-3 py-1.5">
                          <Input aria-label={`Headline for ${g.key}`} placeholder={copy.headlines[0] || "Headline"} value={o.headlines?.[0] ?? ""} onChange={(e) => setOverride(g.key, { headlines: e.target.value ? [e.target.value] : [] })} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>

      <aside aria-label="Live preview" className="self-start 2xl:sticky 2xl:top-6">
        <p className="mb-2 text-label font-medium text-slate-11">Preview{first ? ` · ${first.key}` : ""}</p>
        <PhonePreview placement="feed" files={files} copy={{ ...copy, primaryTexts: copy.primaryTexts.filter(Boolean), headlines: copy.headlines.filter(Boolean) }} pageName={data.preset.pageName} />
      </aside>
    </div>
  );
}

"use client";

import * as React from "react";
import { editAdCopyAction, editObjectAction, loadAdCopyAction, loadEditAction, setBudgetAction } from "@/app/(app)/ads/actions";
import { DateTimeInput, MoneyInput, TextOptions } from "@/components/editor/fields";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, Input, NativeSelect } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import type { ActionResult } from "@/lib/server/action-result";
import { COPY_LIMITS, CTA_TYPES, bidStrategyLabel, label } from "@fahd/shared/meta-options";
import type { AdCopy, EditableObject } from "@fahd/core";
import type { TableRow } from "./columns";

const NOUN = { campaign: "campaign", adset: "ad set", ad: "ad" } as const;
const AGES = Array.from({ length: 53 }, (_, i) => i + 13);

type Loaded = EditableObject & { currency: string };
type Form = { name: string; dailyBudget: number | null; endTime: string | null; continuous: boolean; bidAmount: number | null; roasFloor: string; countries: string; ageMin: number; ageMax: number };

function initial(o: Loaded): Form {
  return {
    name: o.name,
    dailyBudget: o.dailyBudget,
    endTime: o.endTime,
    continuous: !o.endTime,
    bidAmount: o.bidAmount,
    roasFloor: o.roasFloor ? String(o.roasFloor) : "",
    countries: o.countries.join(", "),
    ageMin: o.ageMin ?? 18,
    ageMax: o.ageMax ?? 65,
  };
}

const parseCountries = (s: string) => [...new Set(s.split(/[,\s]+/).map((x) => x.trim().toUpperCase()).filter((x) => /^[A-Z]{2}$/.test(x)))];

/**
 * Ads Manager's edit pane for one live object: name, budget, schedule, bid and
 * audience. Only changed fields are sent; budgets go through the guardrails.
 */
export function EditDialog({ row, onClose, onDone }: { row: TableRow | null; onClose: () => void; onDone: (res: ActionResult<unknown>) => void }) {
  const [loaded, setLoaded] = React.useState<Loaded | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [form, setForm] = React.useState<Form | null>(null);
  const [busy, start] = React.useTransition();
  const [copy, setCopy] = React.useState<AdCopy | null>(null);
  const [copyDraft, setCopyDraft] = React.useState<AdCopy | null>(null);
  const [copyError, setCopyError] = React.useState<string | null>(null);
  const id = row?.id;
  const level = row?.level;

  React.useEffect(() => {
    if (!id || !level) return;
    // Keyed by row id in the parent, so state starts empty for each object.
    let live = true;
    if (level === "ad")
      void loadAdCopyAction(id).then((res) => {
        if (!live) return;
        if (!res.ok || !res.data) return setCopyError(res.ok ? "Couldn't read the ad's text." : `${res.error.title}. ${res.error.detail ?? ""}`);
        setCopy(res.data);
        setCopyDraft(res.data);
      });
    void loadEditAction(level, id).then((res) => {
      if (!live) return;
      if (!res.ok || !res.data) return setError(res.ok ? "Couldn't load it." : `${res.error.title}. ${res.error.detail ?? ""}`);
      setLoaded(res.data);
      setForm(initial(res.data));
    });
    return () => {
      live = false;
    };
  }, [id, level]);

  if (!row) return null;
  const noun = NOUN[row.level];
  const set = (patch: Partial<Form>) => setForm((f) => (f ? { ...f, ...patch } : f));
  const strategy = loaded ? (loaded.bidStrategy ?? loaded.campaignBidStrategy) : null;
  const lifetime = loaded?.lifetimeBudget !== null && loaded?.lifetimeBudget !== undefined;

  function save() {
    if (!loaded || !form || !row) return;
    const edit: Parameters<typeof editObjectAction>[2] = {};
    if (form.name.trim() !== loaded.name) edit.name = form.name.trim();
    if (row.level === "adset") {
      const end = form.continuous && !lifetime ? null : form.endTime;
      if (end !== loaded.endTime) edit.endTime = end;
      if ((strategy === "COST_CAP" || strategy === "LOWEST_COST_WITH_BID_CAP") && form.bidAmount !== loaded.bidAmount && form.bidAmount) edit.bidAmount = form.bidAmount;
      const roas = Number(form.roasFloor);
      if (strategy === "LOWEST_COST_WITH_MIN_ROAS" && roas > 0 && roas !== loaded.roasFloor) edit.roasFloor = roas;
      const countries = parseCountries(form.countries);
      if (countries.join() !== loaded.countries.join()) edit.countries = countries;
      if (form.ageMin !== (loaded.ageMin ?? 18)) edit.ageMin = form.ageMin;
      if (form.ageMax !== (loaded.ageMax ?? 65)) edit.ageMax = form.ageMax;
      if ((edit.ageMin !== undefined || edit.ageMax !== undefined) && !edit.countries) edit.countries = countries;
    }
    const budgetChanged = loaded.dailyBudget !== null && form.dailyBudget !== null && form.dailyBudget !== loaded.dailyBudget;
    const copyChanged = row.level === "ad" && copy && copyDraft && (copy.format === "single" || copy.format === "multi") && JSON.stringify(copy) !== JSON.stringify(copyDraft);
    if (Object.keys(edit).length === 0 && !budgetChanged && !copyChanged) return onClose();
    start(async () => {
      const messages: string[] = [];
      if (Object.keys(edit).length) {
        const res = await editObjectAction(row.level, row.id, edit);
        if (!res.ok) return onDone(res);
        if (res.message) messages.push(res.message);
      }
      if (copyChanged && copyDraft) {
        const { primaryTexts, headlines, descriptions, link, cta, urlTags } = copyDraft;
        const res = await editAdCopyAction(row.id, { primaryTexts, headlines, descriptions, link, cta, urlTags });
        if (!res.ok) return onDone(res);
        if (res.message) messages.push(res.message);
      }
      if (budgetChanged) {
        const res = await setBudgetAction(row.level, row.id, form.dailyBudget!);
        if (!res.ok) return onDone(res);
        if (res.message) messages.push(res.message);
      }
      onDone({ ok: true, message: messages.join(" ") || "Saved." });
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className={row.level === "ad" ? "max-w-xl" : "max-w-lg"}>
        <DialogHeader>
          <DialogTitle>Edit {noun}</DialogTitle>
          <DialogDescription className="truncate">{row.name}</DialogDescription>
        </DialogHeader>
        <form
          className="grid max-h-[calc(100dvh-14rem)] gap-4 overflow-y-auto px-5 py-4"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          {error ? (
            <p role="alert" className="rounded-card border border-red-6 bg-red-2 px-3 py-2 text-ui text-red-11">
              {error}
            </p>
          ) : !loaded || !form ? (
            <div className="grid gap-3" aria-busy="true" aria-label="Loading">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-2/3" />
              <Skeleton className="h-8 w-1/2" />
            </div>
          ) : (
            <>
              <Field label={`${noun[0]!.toUpperCase()}${noun.slice(1)} name`} htmlFor="edit-name">
                <Input id="edit-name" value={form.name} maxLength={400} onChange={(e) => set({ name: e.target.value })} />
              </Field>

              {row.level !== "ad" && loaded.dailyBudget !== null && (
                <Field label="Daily budget" htmlFor="edit-budget" hint={row.level === "campaign" ? "Advantage+ campaign budget, shared by the ad sets." : undefined}>
                  <MoneyInput id="edit-budget" className="w-44" currency={loaded.currency} value={form.dailyBudget} onChange={(dailyBudget) => set({ dailyBudget })} />
                </Field>
              )}
              {row.level !== "ad" && loaded.lifetimeBudget !== null && <p className="text-ui text-slate-11">Lifetime budgets are changed in Ads Manager for now.</p>}

              {row.level === "adset" && (
                <>
                  <fieldset className="grid gap-2">
                    <legend className="mb-1 text-label font-medium text-slate-11">Schedule</legend>
                    {!lifetime && (
                      <label className="flex items-center gap-2 text-ui">
                        <Checkbox checked={form.continuous} onChange={(e) => set({ continuous: e.currentTarget.checked })} />
                        Run continuously, until you pause it
                      </label>
                    )}
                    {(!form.continuous || lifetime) && (
                      <Field label="End date" htmlFor="edit-end">
                        <DateTimeInput id="edit-end" value={form.endTime} onChange={(endTime) => set({ endTime })} />
                      </Field>
                    )}
                  </fieldset>

                  {(strategy === "COST_CAP" || strategy === "LOWEST_COST_WITH_BID_CAP") && (
                    <Field label={strategy === "COST_CAP" ? "Cost per result goal" : "Bid cap"} htmlFor="edit-bid">
                      <MoneyInput id="edit-bid" className="w-44" currency={loaded.currency} value={form.bidAmount} onChange={(bidAmount) => set({ bidAmount })} />
                    </Field>
                  )}
                  {strategy === "LOWEST_COST_WITH_MIN_ROAS" && (
                    <Field label="ROAS goal" htmlFor="edit-roas" hint="2.5 means 2.50 back for every 1 spent.">
                      <Input id="edit-roas" inputMode="decimal" className="w-32 tabular-nums" value={form.roasFloor} onChange={(e) => set({ roasFloor: e.target.value.replace(",", ".") })} />
                    </Field>
                  )}
                  {strategy && <p className="text-label text-slate-11">Bid strategy: {bidStrategyLabel(strategy)}</p>}

                  <fieldset className="grid gap-3">
                    <legend className="mb-1 text-label font-medium text-slate-11">Audience</legend>
                    <Field label="Locations" htmlFor="edit-countries" hint="Country codes, comma separated. Replaces any regions or cities.">
                      <Input id="edit-countries" value={form.countries} onChange={(e) => set({ countries: e.target.value })} />
                    </Field>
                    <div className="flex items-end gap-3">
                      <Field label="Minimum age" htmlFor="edit-age-min">
                        <NativeSelect id="edit-age-min" className="w-24" value={form.ageMin} onChange={(e) => set({ ageMin: Number(e.target.value) })}>
                          {AGES.map((a) => (
                            <option key={a} value={a}>
                              {a}
                            </option>
                          ))}
                        </NativeSelect>
                      </Field>
                      <Field label="Maximum age" htmlFor="edit-age-max">
                        <NativeSelect id="edit-age-max" className="w-24" value={form.ageMax} onChange={(e) => set({ ageMax: Number(e.target.value) })}>
                          {AGES.map((a) => (
                            <option key={a} value={a}>
                              {a === 65 ? "65+" : a}
                            </option>
                          ))}
                        </NativeSelect>
                      </Field>
                    </div>
                  </fieldset>
                </>
              )}

              {row.level === "ad" && (
                <fieldset className="grid gap-3">
                  <legend className="mb-1 text-label font-medium text-slate-11">Ad creative</legend>
                  {copyError ? (
                    <p role="alert" className="text-ui text-red-11">
                      {copyError}
                    </p>
                  ) : !copyDraft ? (
                    <div className="grid gap-2" aria-busy="true" aria-label="Loading the ad's text">
                      <Skeleton className="h-16 w-full" />
                      <Skeleton className="h-8 w-2/3" />
                    </div>
                  ) : copyDraft.format === "post" ? (
                    <p className="text-ui text-slate-11">This ad uses an existing post, so its text can only change on the post itself. To use new text, duplicate the ad and edit the copy.</p>
                  ) : copyDraft.format === "other" ? (
                    <p className="text-ui text-slate-11">This ad&apos;s format (for example a carousel or catalog ad) can&apos;t be edited here yet. You can still rename, pause or duplicate it.</p>
                  ) : (
                    <>
                      <TextOptions label="Primary text" multiline max={copyDraft.format === "multi" ? 5 : 1} values={copyDraft.primaryTexts} onChange={(primaryTexts) => setCopyDraft({ ...copyDraft, primaryTexts })} limit={COPY_LIMITS.primaryText} />
                      <TextOptions label="Headline" max={copyDraft.format === "multi" ? 5 : 1} values={copyDraft.headlines.length ? copyDraft.headlines : [""]} onChange={(headlines) => setCopyDraft({ ...copyDraft, headlines })} limit={COPY_LIMITS.headline} />
                      <TextOptions label="Description" max={copyDraft.format === "multi" ? 5 : 1} values={copyDraft.descriptions.length ? copyDraft.descriptions : [""]} onChange={(descriptions) => setCopyDraft({ ...copyDraft, descriptions })} limit={COPY_LIMITS.description} />
                      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-3">
                        <Field label="Website URL" htmlFor="edit-link">
                          <Input id="edit-link" type="url" value={copyDraft.link} onChange={(e) => setCopyDraft({ ...copyDraft, link: e.target.value })} />
                        </Field>
                        <Field label="Call to action" htmlFor="edit-cta">
                          <NativeSelect id="edit-cta" className="w-40" value={copyDraft.cta} onChange={(e) => setCopyDraft({ ...copyDraft, cta: e.target.value })}>
                            {[...new Set([copyDraft.cta, ...CTA_TYPES])].filter(Boolean).map((c) => (
                              <option key={c} value={c}>
                                {label(c)}
                              </option>
                            ))}
                          </NativeSelect>
                        </Field>
                      </div>
                      <Field label="URL parameters" htmlFor="edit-tags">
                        <Input id="edit-tags" value={copyDraft.urlTags ?? ""} onChange={(e) => setCopyDraft({ ...copyDraft, urlTags: e.target.value || null })} />
                      </Field>
                      <p className="text-label text-slate-11">Publishing makes a new creative with the same image or video. Meta reviews the ad again, and its learning may reset.</p>
                    </>
                  )}
                </fieldset>
              )}
            </>
          )}
          <div className="sticky -bottom-4 -mx-5 -mb-4 flex justify-end gap-2 border-t border-slate-6 bg-slate-1 px-5 py-3 dark:bg-slate-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={!form || busy}>
              {busy ? "Publishing…" : "Publish changes"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

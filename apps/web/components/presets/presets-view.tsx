"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Check, CircleAlert, Copy, FlaskConical, Pencil, Plus, SlidersHorizontal, Trash2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import {
  cloneAdsetTemplateAction,
  createBrand,
  deleteAdsetTemplate,
  deleteNamingTemplate,
  deletePreset,
  saveNamingTemplate,
  savePreset,
  testPresetAction,
} from "@/app/(app)/presets/actions";
import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, Input, NativeSelect } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { ActionResult } from "@/lib/server/action-result";
import { cn } from "@/lib/utils";
import { CONVERSION_EVENTS, CREATIVE_FEATURES, CTA_TYPES, DEFAULT_URL_TAGS, label } from "@fahd/shared/meta-options";
import { NAMING_TOKENS, exampleName } from "@fahd/shared/naming";

type Brand = { id: string; name: string; defaultDomain: string | null };
type Account = { id: string; name: string; metaId: string; currency: string };
type Asset = { kind: "page" | "instagram" | "pixel"; metaId: string; name: string; adAccountId: string | null };
type Naming = { id: string; level: "campaign" | "adset" | "ad"; pattern: string };
type AdsetTemplate = { id: string; name: string; sourceAdsetId: string | null; spec: { optimizationGoal: string; billingEvent: string; bidStrategy?: string; targeting: Record<string, unknown> } };
type Preset = {
  id: string;
  brandId: string;
  market: string;
  language: string;
  adAccountId: string;
  pageId: string;
  instagramUserId: string | null;
  pixelId: string;
  conversionEvent: string;
  linkUrl: string;
  urlTags: string | null;
  defaultCta: string;
  creativeFeatures: Record<string, string>;
  namingTemplateId: string | null;
  adsetNamingTemplateId: string | null;
  adNamingTemplateId: string | null;
  adsetTemplateId: string | null;
};

type Props = {
  canEdit: boolean;
  brands: Brand[];
  presets: Preset[];
  accounts: Account[];
  assets: Asset[];
  naming: Naming[];
  adsetTemplates: AdsetTemplate[];
  adsets: { id: string; name: string; accountName: string }[];
};

function notify(res: ActionResult<unknown>) {
  if (res.ok) toast.success(res.message ?? "Saved");
  else toast.error(res.error.title, { description: [res.error.detail, res.error.fix].filter(Boolean).join(" ") });
}

function useFormAction(action: (prev: ActionResult<never> | null, fd: FormData) => Promise<ActionResult<unknown>>, onOk?: () => void) {
  const router = useRouter();
  return React.useActionState(async (prev: ActionResult<unknown> | null, fd: FormData) => {
    const res = await action(prev as ActionResult<never> | null, fd);
    if (res.ok) {
      notify(res);
      onOk?.();
      router.refresh();
    }
    return res;
  }, null);
}

function FormError({ state }: { state: ActionResult<unknown> | null }) {
  if (!state || state.ok) return null;
  return (
    <p role="alert" className="rounded-control border border-red-6 bg-red-2 px-3 py-2 text-ui text-red-11">
      <span className="font-medium">{state.error.title}.</span> {state.error.detail} {state.error.fix}
    </p>
  );
}

export function PresetsView(props: Props) {
  return (
    <Tabs defaultValue="presets">
      <TabsList>
        <TabsTrigger value="presets">Presets</TabsTrigger>
        <TabsTrigger value="naming">Naming templates</TabsTrigger>
        <TabsTrigger value="adsets">Ad set templates</TabsTrigger>
      </TabsList>
      <TabsContent value="presets" className="pt-5">
        <PresetsTab {...props} />
      </TabsContent>
      <TabsContent value="naming" className="pt-5">
        <NamingTab naming={props.naming} canEdit={props.canEdit} />
      </TabsContent>
      <TabsContent value="adsets" className="pt-5">
        <AdsetTemplatesTab templates={props.adsetTemplates} adsets={props.adsets} canEdit={props.canEdit} />
      </TabsContent>
    </Tabs>
  );
}

// --- Presets -----------------------------------------------------------------

function PresetsTab({ canEdit, brands, presets, accounts, assets, naming, adsetTemplates }: Props) {
  const [editing, setEditing] = React.useState<Partial<Preset> | null>(null);
  const [brandOpen, setBrandOpen] = React.useState(false);
  const [brandState, brandAction, brandPending] = useFormAction(createBrand, () => setBrandOpen(false));

  if (accounts.length === 0) {
    return (
      <EmptyState
        icon={SlidersHorizontal}
        title="Connect Meta first"
        description="A preset points at an ad account, page, Instagram account and pixel, which come from a connected Business Manager."
        action={
          <Button variant="primary" asChild>
            <a href="/settings">Connect Meta</a>
          </Button>
        }
      />
    );
  }

  return (
    <div className="grid gap-6">
      {canEdit && (
        <div className="flex gap-2">
          <Button variant="primary" onClick={() => setEditing({ brandId: brands[0]?.id, urlTags: DEFAULT_URL_TAGS })} disabled={brands.length === 0}>
            <Plus />
            New preset
          </Button>
          <Button onClick={() => setBrandOpen(true)}>New brand</Button>
        </div>
      )}
      {brands.length === 0 && <p className="text-body text-slate-11">Add a brand to start.</p>}
      {brands.map((b) => {
        const list = presets.filter((p) => p.brandId === b.id);
        return (
          <section key={b.id} aria-labelledby={`brand-${b.id}`}>
            <h2 id={`brand-${b.id}`} className="mb-2 text-section font-semibold">
              {b.name}
              {b.defaultDomain && <span className="ml-2 text-ui font-normal text-slate-11">{b.defaultDomain}</span>}
            </h2>
            {list.length === 0 ? (
              <p className="rounded-card border border-dashed border-slate-7 px-4 py-6 text-center text-body text-slate-11">No presets for {b.name} yet.</p>
            ) : (
              <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {list.map((p) => (
                  <PresetCard key={p.id} preset={p} accounts={accounts} assets={assets} canEdit={canEdit} onEdit={() => setEditing(p)} onDuplicate={() => setEditing({ ...p, id: undefined, market: "" })} />
                ))}
              </ul>
            )}
          </section>
        );
      })}

      {editing && (
        <PresetDialog
          key={editing.id ?? "new"}
          preset={editing}
          brands={brands}
          accounts={accounts}
          assets={assets}
          naming={naming}
          adsetTemplates={adsetTemplates}
          onClose={() => setEditing(null)}
        />
      )}
      <Dialog open={brandOpen} onOpenChange={setBrandOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>New brand</DialogTitle>
            <DialogDescription>Brands group presets and creatives.</DialogDescription>
          </DialogHeader>
          <form action={brandAction} className="grid gap-3 px-5 py-4">
            <Field label="Name" htmlFor="brand-name">
              <Input id="brand-name" name="name" required />
            </Field>
            <Field label="Default domain" htmlFor="brand-domain">
              <Input id="brand-domain" name="defaultDomain" placeholder="brand.com" />
            </Field>
            <FormError state={brandState} />
            <div className="flex justify-end gap-2">
              <Button onClick={() => setBrandOpen(false)}>Cancel</Button>
              <Button type="submit" variant="primary" disabled={brandPending}>
                Add brand
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PresetCard({ preset: p, accounts, assets, canEdit, onEdit, onDuplicate }: { preset: Preset; accounts: Account[]; assets: Asset[]; canEdit: boolean; onEdit: () => void; onDuplicate: () => void }) {
  const router = useRouter();
  const [busy, start] = React.useTransition();
  const [lines, setLines] = React.useState<{ label: string; ok: boolean; detail: string; warning?: boolean }[] | null>(null);
  const { confirm, dialog } = useConfirm();
  const account = accounts.find((a) => a.id === p.adAccountId);
  const name = (kind: Asset["kind"], id: string | null) => (id ? (assets.find((a) => a.kind === kind && a.metaId === id)?.name ?? id) : "—");
  const optIns = Object.values(p.creativeFeatures).filter((v) => v === "OPT_IN").length;

  return (
    <li className="grid gap-3 rounded-card border border-slate-6 p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-body font-semibold">
            {p.market} · {p.language}
          </p>
          <p className="text-ui text-slate-11">{account?.name ?? "Unknown account"}</p>
        </div>
        {canEdit && (
          <div className="flex gap-1">
            <Button size="icon-sm" variant="ghost" aria-label="Edit preset" onClick={onEdit}>
              <Pencil />
            </Button>
            <Button size="icon-sm" variant="ghost" aria-label="Duplicate preset" onClick={onDuplicate}>
              <Copy />
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Delete preset"
              disabled={busy}
              onClick={async () => {
                if (!(await confirm({ title: `Delete preset ${p.market} · ${p.language}?`, description: "Launches that used it keep their history. New launches can't pick it.", confirmLabel: "Delete preset", destructive: true }))) return;
                start(async () => {
                  notify(await deletePreset(p.id));
                  router.refresh();
                });
              }}
            >
              <Trash2 />
            </Button>
          </div>
        )}
      </div>
      <dl className="grid grid-cols-[96px_minmax(0,1fr)] gap-x-3 gap-y-1 text-ui">
        <dt className="text-slate-11">Page</dt>
        <dd className="truncate">{name("page", p.pageId)}</dd>
        <dt className="text-slate-11">Instagram</dt>
        <dd className="truncate">{p.instagramUserId ? `@${name("instagram", p.instagramUserId)}` : "—"}</dd>
        <dt className="text-slate-11">Pixel</dt>
        <dd className="truncate">
          {name("pixel", p.pixelId)} · {label(p.conversionEvent)}
        </dd>
        <dt className="text-slate-11">Link</dt>
        <dd className="truncate">{p.linkUrl}</dd>
        <dt className="text-slate-11">CTA</dt>
        <dd>{label(p.defaultCta)}</dd>
        <dt className="text-slate-11">Advantage+</dt>
        <dd>{optIns ? `${optIns} creative features on` : "All creative features off"}</dd>
      </dl>
      <Button
        disabled={busy}
        onClick={() =>
          start(async () => {
            const res = await testPresetAction(p.id);
            if (res.ok) setLines(res.data ?? []);
            else notify(res);
          })
        }
      >
        <FlaskConical />
        {busy ? "Testing…" : "Test preset"}
      </Button>
      {lines && (
        <ul aria-label="Test results" className="grid gap-1 text-ui">
          {lines.map((l) => (
            <li key={l.label} className={cn("flex gap-2", l.ok ? (l.warning ? "text-amber-11" : "text-grass-11") : "text-red-11")}>
              {l.ok ? l.warning ? <TriangleAlert className="mt-0.5 size-4 shrink-0" /> : <Check className="mt-0.5 size-4 shrink-0" /> : <CircleAlert className="mt-0.5 size-4 shrink-0" />}
              <span>
                <span className="font-medium">{l.label}</span>
                <span className="text-slate-11"> · {l.detail}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      {dialog}
    </li>
  );
}

function PresetDialog({
  preset,
  brands,
  accounts,
  assets,
  naming,
  adsetTemplates,
  onClose,
}: {
  preset: Partial<Preset>;
  brands: Brand[];
  accounts: Account[];
  assets: Asset[];
  naming: Naming[];
  adsetTemplates: AdsetTemplate[];
  onClose: () => void;
}) {
  const [state, action, pending] = useFormAction(savePreset, onClose);
  const [accountId, setAccountId] = React.useState(preset.adAccountId ?? accounts[0]?.id ?? "");
  const firstOf = (kind: Asset["kind"], account: string) => assets.find((a) => a.kind === kind && a.adAccountId === account)?.metaId ?? "";
  // Instagram accounts and pixels belong to an ad account, so they follow its choice.
  const [igId, setIgId] = React.useState(preset.instagramUserId ?? firstOf("instagram", accountId));
  const [pixelId, setPixelId] = React.useState(preset.pixelId ?? firstOf("pixel", accountId));
  const changeAccount = (id: string) => {
    setAccountId(id);
    setIgId(firstOf("instagram", id));
    setPixelId(firstOf("pixel", id));
  };
  const [features, setFeatures] = React.useState<Record<string, boolean>>(() =>
    Object.fromEntries(CREATIVE_FEATURES.map((f) => [f.key, preset.creativeFeatures?.[f.key] === "OPT_IN"])),
  );
  const pages = assets.filter((a) => a.kind === "page");
  const igs = assets.filter((a) => a.kind === "instagram" && a.adAccountId === accountId);
  const pixels = assets.filter((a) => a.kind === "pixel" && a.adAccountId === accountId);
  const templates = (level: Naming["level"]) => naming.filter((n) => n.level === level);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{preset.id ? "Edit preset" : "New preset"}</DialogTitle>
          <DialogDescription>Everything a launch for this brand and market needs, filled in one click.</DialogDescription>
        </DialogHeader>
        <form action={action} className="grid max-h-[70vh] gap-4 overflow-y-auto px-5 py-4">
          <input type="hidden" name="id" value={preset.id ?? ""} />
          <div className="grid grid-cols-3 gap-3">
            <Field label="Brand" htmlFor="p-brand">
              <NativeSelect id="p-brand" name="brandId" defaultValue={preset.brandId}>
                {brands.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Market" htmlFor="p-market" hint="Country code, e.g. US">
              <Input id="p-market" name="market" defaultValue={preset.market} maxLength={2} required className="uppercase" />
            </Field>
            <Field label="Language" htmlFor="p-language">
              <Input id="p-language" name="language" defaultValue={preset.language ?? "en"} required />
            </Field>
          </div>
          <Field label="Ad account" htmlFor="p-account">
            <NativeSelect id="p-account" name="adAccountId" value={accountId} onChange={(e) => changeAccount(e.target.value)}>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} · {a.metaId}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Facebook page" htmlFor="p-page">
              <NativeSelect id="p-page" name="pageId" defaultValue={preset.pageId}>
                {pages.map((a) => (
                  <option key={a.metaId} value={a.metaId}>
                    {a.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Instagram account" htmlFor="p-ig">
              <NativeSelect id="p-ig" name="instagramUserId" value={igId} onChange={(e) => setIgId(e.target.value)}>
                <option value="">None (Facebook only)</option>
                {igs.map((a) => (
                  <option key={a.metaId} value={a.metaId}>
                    @{a.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Pixel" htmlFor="p-pixel">
              <NativeSelect id="p-pixel" name="pixelId" value={pixelId} onChange={(e) => setPixelId(e.target.value)}>
                {pixels.map((a) => (
                  <option key={a.metaId} value={a.metaId}>
                    {a.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Conversion event" htmlFor="p-event">
              <NativeSelect id="p-event" name="conversionEvent" defaultValue={preset.conversionEvent ?? "PURCHASE"}>
                {CONVERSION_EVENTS.map((e) => (
                  <option key={e} value={e}>
                    {label(e)}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Default CTA" htmlFor="p-cta">
              <NativeSelect id="p-cta" name="defaultCta" defaultValue={preset.defaultCta ?? "SHOP_NOW"}>
                {CTA_TYPES.map((c) => (
                  <option key={c} value={c}>
                    {label(c)}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          </div>
          <Field label="Link" htmlFor="p-link">
            <Input id="p-link" name="linkUrl" type="url" defaultValue={preset.linkUrl} placeholder="https://brand.com/us" required />
          </Field>
          <Field label="URL parameters" htmlFor="p-utm" hint="Meta fills {{campaign.name}} and {{ad.name}} at delivery.">
            <Input id="p-utm" name="urlTags" defaultValue={preset.urlTags ?? DEFAULT_URL_TAGS} className="font-mono text-label" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            {(["campaign", "adset", "ad"] as const).map((level) => (
              <Field key={level} label={`${level === "adset" ? "Ad set" : level.charAt(0).toUpperCase() + level.slice(1)} naming`} htmlFor={`p-naming-${level}`}>
                <NativeSelect
                  id={`p-naming-${level}`}
                  name={level === "campaign" ? "namingTemplateId" : level === "adset" ? "adsetNamingTemplateId" : "adNamingTemplateId"}
                  defaultValue={(level === "campaign" ? preset.namingTemplateId : level === "adset" ? preset.adsetNamingTemplateId : preset.adNamingTemplateId) ?? templates(level)[0]?.id ?? ""}
                >
                  <option value="">None</option>
                  {templates(level).map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.pattern}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            ))}
            <Field label="Ad set template" htmlFor="p-adset-template">
              <NativeSelect id="p-adset-template" name="adsetTemplateId" defaultValue={preset.adsetTemplateId ?? ""}>
                <option value="">None</option>
                {adsetTemplates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          </div>
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-label font-medium text-slate-11">Advantage+ creative defaults</legend>
            <div className="grid grid-cols-2 gap-x-4 gap-y-2">
              {CREATIVE_FEATURES.map((f) => (
                <label key={f.key} className="flex items-center gap-2 text-ui">
                  <Switch checked={features[f.key]} onCheckedChange={(on) => setFeatures((s) => ({ ...s, [f.key]: on }))} aria-label={f.label} />
                  <input type="hidden" name={`feature_${f.key}`} value={features[f.key] ? "on" : ""} />
                  {f.label}
                </label>
              ))}
            </div>
          </fieldset>
          <FormError state={state} />
          <div className="flex justify-end gap-2">
            <Button onClick={onClose}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={pending}>
              {pending ? "Saving…" : "Save preset"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// --- Naming templates --------------------------------------------------------

function NamingTab({ naming, canEdit }: { naming: Naming[]; canEdit: boolean }) {
  const router = useRouter();
  const [busy, start] = React.useTransition();
  const { confirm, dialog } = useConfirm();
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      {(["campaign", "adset", "ad"] as const).map((level) => (
        <section key={level} aria-labelledby={`naming-${level}`} className="grid content-start gap-3 rounded-card border border-slate-6 p-4">
          <h2 id={`naming-${level}`} className="text-section font-semibold">
            {level === "adset" ? "Ad set" : level.charAt(0).toUpperCase() + level.slice(1)} names
          </h2>
          <ul className="grid gap-2">
            {naming
              .filter((n) => n.level === level)
              .map((n) => (
                <li key={n.id} className="flex items-start justify-between gap-2 rounded-control border border-slate-6 px-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate font-mono text-label">{n.pattern}</p>
                    <p className="truncate text-ui text-slate-11">{exampleName(n.pattern)}</p>
                  </div>
                  {canEdit && (
                    <Button size="icon-sm" variant="ghost" aria-label={`Delete ${n.pattern}`} disabled={busy} onClick={async () => {
                        if (await confirm({ title: "Delete this naming template?", description: `${n.pattern} — presets using it fall back to the default pattern.`, confirmLabel: "Delete template", destructive: true })) {
                          start(async () => (notify(await deleteNamingTemplate(n.id)), router.refresh()));
                        }
                      }}>
                      <Trash2 />
                    </Button>
                  )}
                </li>
              ))}
          </ul>
          {canEdit && <NamingEditor level={level} />}
        </section>
      ))}
      {dialog}
    </div>
  );
}

function NamingEditor({ level }: { level: Naming["level"] }) {
  const [pattern, setPattern] = React.useState("");
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [state, action, pending] = useFormAction(saveNamingTemplate, () => setPattern(""));
  const insert = (token: string) => {
    const el = inputRef.current;
    const at = el?.selectionStart ?? pattern.length;
    const sep = at > 0 && !/[_\-\s]$/.test(pattern.slice(0, at)) ? "_" : "";
    setPattern(`${pattern.slice(0, at)}${sep}{${token}}${pattern.slice(at)}`);
    requestAnimationFrame(() => el?.focus());
  };
  return (
    <form action={action} className="grid gap-2 border-t border-slate-6 pt-3">
      <input type="hidden" name="level" value={level} />
      <Input ref={inputRef} name="pattern" value={pattern} onChange={(e) => setPattern(e.target.value)} placeholder="{brand}_{market}_{date}" aria-label={`New ${level} naming pattern`} className="font-mono text-label" />
      <div className="flex flex-wrap gap-1" aria-label="Tokens">
        {NAMING_TOKENS.map((t) => (
          <button key={t} type="button" onClick={() => insert(t)} className="rounded-xs bg-slate-3 px-1.5 py-0.5 font-mono text-label text-slate-11 hover:bg-slate-4 hover:text-slate-12">
            {`{${t}}`}
          </button>
        ))}
      </div>
      <p className="text-ui text-slate-11">
        Example: <span className="text-slate-12">{exampleName(pattern)}</span>
      </p>
      <FormError state={state} />
      <Button type="submit" disabled={pending || !pattern.trim()} className="justify-self-start">
        <Plus />
        Add template
      </Button>
    </form>
  );
}

// --- Ad set templates --------------------------------------------------------

function AdsetTemplatesTab({ templates, adsets, canEdit }: { templates: AdsetTemplate[]; adsets: { id: string; name: string; accountName: string }[]; canEdit: boolean }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [picked, setPicked] = React.useState<{ id: string; name: string } | null>(null);
  const [name, setName] = React.useState("");
  const [busy, start] = React.useTransition();
  const { confirm, dialog } = useConfirm();

  return (
    <div className="grid gap-4">
      {canEdit && (
        <Button variant="primary" className="justify-self-start" onClick={() => setOpen(true)} disabled={adsets.length === 0}>
          <Copy />
          Clone from a live ad set
        </Button>
      )}
      {templates.length === 0 ? (
        <p className="text-body text-slate-11">No ad set templates yet. Clone one from a winning ad set to reuse its optimization, bidding and targeting.</p>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {templates.map((t) => {
            const countries = (t.spec.targeting as { geo_locations?: { countries?: string[] } }).geo_locations?.countries;
            const advantage = (t.spec.targeting as { targeting_automation?: { advantage_audience?: number } }).targeting_automation?.advantage_audience;
            return (
              <li key={t.id} className="grid gap-2 rounded-card border border-slate-6 p-4">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-body font-semibold">{t.name}</p>
                  {canEdit && (
                    <Button size="icon-sm" variant="ghost" aria-label={`Delete ${t.name}`} disabled={busy} onClick={async () => {
                        if (await confirm({ title: `Delete ${t.name}?`, description: "Presets using it fall back to Meta's defaults for new ad sets.", confirmLabel: "Delete template", destructive: true })) {
                          start(async () => (notify(await deleteAdsetTemplate(t.id)), router.refresh()));
                        }
                      }}>
                      <Trash2 />
                    </Button>
                  )}
                </div>
                <p className="flex flex-wrap gap-1">
                  <Badge>{label(t.spec.optimizationGoal)}</Badge>
                  <Badge>{label(t.spec.billingEvent)}</Badge>
                  {t.spec.bidStrategy && <Badge>{label(t.spec.bidStrategy)}</Badge>}
                  {countries && <Badge>{countries.join(", ")}</Badge>}
                  {advantage ? <Badge tone="accent">Advantage+ audience</Badge> : null}
                </p>
                {t.sourceAdsetId && <p className="font-mono text-label text-slate-11">from {t.sourceAdsetId}</p>}
              </li>
            );
          })}
        </ul>
      )}
      <Dialog open={open} onOpenChange={(o) => (setOpen(o), !o && (setPicked(null), setName("")))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Clone a live ad set</DialogTitle>
            <DialogDescription>Reads its optimization, billing, bidding, targeting and attribution from Meta.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 px-5 py-4">
            <Command className="rounded-control border border-slate-6">
              <CommandInput placeholder="Search ad sets" />
              <CommandList className="max-h-56">
                <CommandEmpty>No ad sets match.</CommandEmpty>
                {adsets.map((a) => (
                  <CommandItem key={a.id} value={`${a.name} ${a.accountName}`} onSelect={() => (setPicked(a), setName(a.name))}>
                    <span className="truncate">{a.name}</span>
                    <span className="ml-auto text-label text-slate-11">{a.accountName}</span>
                    {picked?.id === a.id && <Check className="text-slate-12!" />}
                  </CommandItem>
                ))}
              </CommandList>
            </Command>
            <Field label="Template name" htmlFor="tpl-name">
              <Input id="tpl-name" value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <div className="flex justify-end gap-2">
              <Button onClick={() => setOpen(false)}>Cancel</Button>
              <Button
                variant="primary"
                disabled={!picked || !name.trim() || busy}
                onClick={() =>
                  start(async () => {
                    const res = await cloneAdsetTemplateAction(picked!.id, name);
                    notify(res);
                    if (res.ok) {
                      setOpen(false);
                      router.refresh();
                    }
                  })
                }
              >
                {busy ? "Reading from Meta…" : "Save template"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      {dialog}
    </div>
  );
}

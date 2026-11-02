"use client";

import * as React from "react";
import { ImagePlus, Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, Input, NativeSelect } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { LibraryPicker, type LibraryGroup } from "@/components/launch/creatives-step";
import { PhonePreview } from "@/components/launch/phone-preview";
import type { CreativeItem } from "@/lib/server/creatives";
import type { EditorAccount } from "@/lib/server/editor";
import { cn } from "@/lib/utils";
import type { EditorAd, EditorAdset, EditorCampaign, EditorIssue } from "@fahd/shared/editor";
import type { BidStrategy, Placement } from "@fahd/shared/launch-plan";
import { COPY_LIMITS, CONVERSION_EVENTS, CREATIVE_FEATURES, CTA_TYPES, label } from "@fahd/shared/meta-options";
import { DateTimeInput, MoneyInput, Section, Segmented, TextOptions } from "./fields";

const BID_STRATEGIES: { value: BidStrategy; label: string; hint: string }[] = [
  { value: "LOWEST_COST_WITHOUT_CAP", label: "Highest volume", hint: "Get the most results for your budget." },
  { value: "COST_CAP", label: "Cost per result goal", hint: "Aim for an average cost per result." },
  { value: "LOWEST_COST_WITH_MIN_ROAS", label: "ROAS goal", hint: "Aim for a minimum return on ad spend." },
  { value: "LOWEST_COST_WITH_BID_CAP", label: "Bid cap", hint: "Set the most you'll bid in any auction." },
];

function Issues({ node, issues }: { node: string; issues: EditorIssue[] }) {
  const mine = issues.filter((i) => i.node === node);
  if (!mine.length) return null;
  return (
    <div role="status" className="rounded-card border border-red-6 bg-red-2 px-4 py-3 text-ui">
      <ul className="grid gap-1">
        {mine.map((i) => (
          <li key={i.message} className={i.level === "error" ? "text-red-11" : "text-amber-11"}>
            {i.message}
          </li>
        ))}
      </ul>
    </div>
  );
}

// --- Campaign -------------------------------------------------------------------

export function CampaignForm({ c, onChange, currency, issues }: { c: EditorCampaign; onChange: (c: EditorCampaign) => void; currency: string; issues: EditorIssue[] }) {
  const set = (patch: Partial<EditorCampaign>) => onChange({ ...c, ...patch });
  return (
    <div className="grid gap-4">
      <Issues node="campaign" issues={issues} />
      <Section title="Campaign name" id="campaign-name">
        <Input aria-label="Campaign name" value={c.name} maxLength={400} onChange={(e) => set({ name: e.target.value })} />
      </Section>
      <Section title="Campaign details" id="campaign-details">
        <dl className="grid grid-cols-[140px_minmax(0,1fr)] gap-y-2 text-ui">
          <dt className="text-slate-11">Buying type</dt>
          <dd>Auction</dd>
          <dt className="text-slate-11">Campaign objective</dt>
          <dd>Sales</dd>
        </dl>
      </Section>
      <Section title="Budget" id="campaign-budget" description="Advantage+ campaign budget spreads one budget across ad sets to get more results.">
        <label className="flex items-center justify-between gap-4 text-ui">
          <span>
            <span className="font-medium">Advantage+ campaign budget</span>
            <span className="block text-slate-11">{c.campaignBudget ? "On: the budget is set here." : "Off: each ad set has its own budget."}</span>
          </span>
          <Switch aria-label="Advantage+ campaign budget" checked={c.campaignBudget} onCheckedChange={(on) => set({ campaignBudget: on })} />
        </label>
        {c.campaignBudget && (
          <div className="flex flex-wrap items-end gap-3">
            <Segmented name="campaign-budget-type" value={c.budgetType} onChange={(v) => set({ budgetType: v })} options={[{ value: "daily", label: "Daily budget" }, { value: "lifetime", label: "Lifetime budget" }]} />
            <MoneyInput id="campaign-budget-amount" aria-label="Campaign budget" className="w-44" currency={currency} value={c.budget} onChange={(budget) => set({ budget })} />
          </div>
        )}
        <Field label="Campaign bid strategy" htmlFor="bid-strategy" hint={BID_STRATEGIES.find((b) => b.value === c.bidStrategy)?.hint}>
          <NativeSelect id="bid-strategy" value={c.bidStrategy} onChange={(e) => set({ bidStrategy: e.target.value as BidStrategy })}>
            {BID_STRATEGIES.map((b) => (
              <option key={b.value} value={b.value}>
                {b.label}
              </option>
            ))}
          </NativeSelect>
        </Field>
        {c.campaignBudget && c.budgetType === "lifetime" && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Start date" htmlFor="campaign-start">
              <DateTimeInput id="campaign-start" value={c.startTime} onChange={(startTime) => set({ startTime })} />
            </Field>
            <Field label="End date" htmlFor="campaign-end">
              <DateTimeInput id="campaign-end" value={c.endTime} onChange={(endTime) => set({ endTime })} />
            </Field>
          </div>
        )}
      </Section>
    </div>
  );
}

// --- Ad set ---------------------------------------------------------------------

const PLACEMENT_GROUPS: { platform: string; items: { value: Placement; label: string }[] }[] = [
  { platform: "Facebook", items: [{ value: "facebook_feed", label: "Feed" }, { value: "facebook_stories", label: "Stories" }, { value: "facebook_reels", label: "Reels" }] },
  { platform: "Instagram", items: [{ value: "instagram_feed", label: "Feed" }, { value: "instagram_stories", label: "Stories" }, { value: "instagram_reels", label: "Reels" }, { value: "instagram_explore", label: "Explore" }] },
  { platform: "Audience Network", items: [{ value: "audience_network", label: "Native, banner and interstitial" }] },
  { platform: "Messenger", items: [{ value: "messenger", label: "Inbox" }] },
];

const ATTRIBUTION = [
  { value: "7d_click_1d_view", label: "7-day click or 1-day view" },
  { value: "7d_click", label: "7-day click" },
  { value: "1d_click_1d_view", label: "1-day click or 1-day view" },
  { value: "1d_click", label: "1-day click" },
] as const;

const AGES = Array.from({ length: 48 }, (_, i) => i + 18);

export function AdsetForm({
  s,
  campaign,
  onChange,
  account,
  currency,
  issues,
  onBulkAds,
}: {
  s: EditorAdset;
  campaign: EditorCampaign;
  onChange: (s: EditorAdset) => void;
  account: EditorAccount;
  currency: string;
  issues: EditorIssue[];
  onBulkAds: () => void;
}) {
  const set = (patch: Partial<EditorAdset>) => onChange({ ...s, ...patch });
  const manual = Array.isArray(s.placements);
  const chosen = manual ? (s.placements as Placement[]) : [];
  const bidLabel = campaign.bidStrategy === "COST_CAP" ? "Cost per result goal" : campaign.bidStrategy === "LOWEST_COST_WITH_BID_CAP" ? "Bid cap" : "ROAS goal";
  return (
    <div className="grid gap-4">
      <Issues node={s.key} issues={issues} />
      <Section title="Ad set name" id="adset-name">
        <Input aria-label="Ad set name" value={s.name} maxLength={400} onChange={(e) => set({ name: e.target.value })} />
      </Section>

      <Section title="Conversion" id="adset-conversion">
        <dl className="grid grid-cols-[140px_minmax(0,1fr)] gap-y-2 text-ui">
          <dt className="text-slate-11">Conversion location</dt>
          <dd>Website</dd>
        </dl>
        <Field label="Performance goal" htmlFor="performance-goal">
          <NativeSelect id="performance-goal" value={s.performanceGoal} onChange={(e) => set({ performanceGoal: e.target.value as EditorAdset["performanceGoal"] })}>
            <option value="OFFSITE_CONVERSIONS">Maximize number of conversions</option>
            <option value="VALUE">Maximize value of conversions</option>
          </NativeSelect>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Dataset (pixel)" htmlFor="pixel">
            <NativeSelect id="pixel" value={s.pixelId} onChange={(e) => set({ pixelId: e.target.value })}>
              {account.pixels.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
              {!account.pixels.some((p) => p.id === s.pixelId) && <option value={s.pixelId}>{s.pixelId}</option>}
            </NativeSelect>
          </Field>
          <Field label="Conversion event" htmlFor="event">
            <NativeSelect id="event" value={s.event} onChange={(e) => set({ event: e.target.value })}>
              {CONVERSION_EVENTS.map((e) => (
                <option key={e} value={e}>
                  {label(e)}
                </option>
              ))}
            </NativeSelect>
          </Field>
        </div>
        {campaign.bidStrategy !== "LOWEST_COST_WITHOUT_CAP" &&
          (campaign.bidStrategy === "LOWEST_COST_WITH_MIN_ROAS" ? (
            <Field label="ROAS goal" htmlFor="roas-goal" hint="For example 2.5 means $2.50 back for every $1 spent.">
              <Input
                id="roas-goal"
                inputMode="decimal"
                className="w-32 tabular-nums"
                defaultValue={s.bidAmount ? String(s.bidAmount / 10000) : ""}
                onChange={(e) => set({ bidAmount: Math.round((Number(e.target.value) || 0) * 10000) || null })}
              />
            </Field>
          ) : (
            <Field label={bidLabel} htmlFor="bid-amount">
              <MoneyInput id="bid-amount" className="w-44" currency={currency} value={s.bidAmount ?? 0} onChange={(bidAmount) => set({ bidAmount: bidAmount || null })} />
            </Field>
          ))}
      </Section>

      <Section title="Budget & schedule" id="adset-budget">
        {campaign.campaignBudget ? (
          <p className="text-ui text-slate-11">Advantage+ campaign budget is on, so this ad set uses the campaign&apos;s budget.</p>
        ) : (
          <div className="flex flex-wrap items-end gap-3">
            <Segmented name={`budget-type-${s.key}`} value={s.budgetType} onChange={(v) => set({ budgetType: v })} options={[{ value: "daily", label: "Daily budget" }, { value: "lifetime", label: "Lifetime budget" }]} />
            <MoneyInput key={s.key} id="adset-budget-amount" aria-label="Ad set budget" className="w-44" currency={currency} value={s.budget} onChange={(budget) => set({ budget })} />
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Start date" htmlFor="adset-start" hint="Empty: starts when you turn it on.">
            <DateTimeInput id="adset-start" value={s.startTime} onChange={(startTime) => set({ startTime })} />
          </Field>
          <Field label="End date" htmlFor="adset-end" hint="Empty: runs until you pause it.">
            <DateTimeInput id="adset-end" value={s.endTime} onChange={(endTime) => set({ endTime })} />
          </Field>
        </div>
      </Section>

      <Section title="Audience" id="adset-audience" description="Advantage+ audience finds the people most likely to buy. Age and gender act as suggestions unless you narrow them.">
        <Field label="Locations" htmlFor="locations" hint="Country codes, comma separated (US, GB, MA).">
          <Input
            id="locations"
            defaultValue={s.countries.join(", ")}
            onChange={(e) =>
              set({
                countries: e.target.value
                  .split(/[,\s]+/)
                  .map((x) => x.trim().toUpperCase())
                  .filter((x) => /^[A-Z]{2}$/.test(x)),
              })
            }
          />
        </Field>
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Minimum age" htmlFor="age-min">
            <NativeSelect id="age-min" className="w-24" value={s.ageMin} onChange={(e) => set({ ageMin: Number(e.target.value) })}>
              {AGES.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Maximum age" htmlFor="age-max">
            <NativeSelect id="age-max" className="w-24" value={s.ageMax} onChange={(e) => set({ ageMax: Number(e.target.value) })}>
              {AGES.map((a) => (
                <option key={a} value={a}>
                  {a === 65 ? "65+" : a}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <fieldset className="grid gap-1.5">
            <legend className="mb-1.5 text-label font-medium text-slate-11">Gender</legend>
            <Segmented name={`gender-${s.key}`} value={s.gender} onChange={(gender) => set({ gender })} options={[{ value: "all", label: "All" }, { value: "male", label: "Men" }, { value: "female", label: "Women" }]} />
          </fieldset>
        </div>
        {(s.ageMin > 25 || s.ageMax < 65 || s.gender !== "all") && <p className="text-label text-amber-11">These limits switch this ad set from Advantage+ audience to the original audience.</p>}
      </Section>

      <Section title="Placements" id="adset-placements">
        <div className="grid gap-2 text-ui">
          <label className="flex items-start gap-2.5">
            <input type="radio" name={`placements-${s.key}`} className="mt-0.5 accent-iris-9" checked={!manual} onChange={() => set({ placements: "advantage" })} />
            <span>
              <span className="font-medium">Advantage+ placements (recommended)</span>
              <span className="block text-slate-11">Meta shows your ads where they&apos;re likely to perform best.</span>
            </span>
          </label>
          <label className="flex items-start gap-2.5">
            <input
              type="radio"
              name={`placements-${s.key}`}
              className="mt-0.5 accent-iris-9"
              checked={manual}
              onChange={() => set({ placements: ["facebook_feed", "facebook_stories", "facebook_reels", "instagram_feed", "instagram_stories", "instagram_reels", "instagram_explore"] })}
            />
            <span className="font-medium">Manual placements</span>
          </label>
        </div>
        {manual && (
          <div className="grid gap-3 pl-6 sm:grid-cols-2">
            {PLACEMENT_GROUPS.map((g) => (
              <fieldset key={g.platform} className="grid gap-1.5">
                <legend className="mb-1 text-label font-medium text-slate-11">{g.platform}</legend>
                {g.items.map((it) => (
                  <label key={it.value} className="flex items-center gap-2 text-ui">
                    <Checkbox
                      checked={chosen.includes(it.value)}
                      onChange={() => set({ placements: chosen.includes(it.value) ? chosen.filter((x) => x !== it.value) : [...chosen, it.value] })}
                    />
                    {it.label}
                  </label>
                ))}
              </fieldset>
            ))}
          </div>
        )}
      </Section>

      <Section title="Attribution setting" id="adset-attribution">
        <NativeSelect aria-label="Attribution setting" value={s.attribution} onChange={(e) => set({ attribution: e.target.value as EditorAdset["attribution"] })}>
          {ATTRIBUTION.map((a) => (
            <option key={a.value} value={a.value}>
              {a.label}
            </option>
          ))}
        </NativeSelect>
      </Section>

      <Section title="Ads in this ad set" id="adset-ads" description={`${s.ads.length} of 50 ads. Add one ad per creative from your library in one go.`}>
        <Button className="justify-self-start" onClick={onBulkAds}>
          <ImagePlus />
          Create ads from library
        </Button>
      </Section>
    </div>
  );
}

// --- Ad -------------------------------------------------------------------------

export function AdForm({
  a,
  onChange,
  account,
  library,
  brandId,
  issues,
  onUpload,
}: {
  a: EditorAd;
  onChange: (a: EditorAd) => void;
  account: EditorAccount;
  library: CreativeItem[];
  brandId: string;
  issues: EditorIssue[];
  onUpload: () => void;
}) {
  const set = (patch: Partial<EditorAd>) => onChange({ ...a, ...patch });
  const [picking, setPicking] = React.useState(false);
  const byId = React.useMemo(() => new Map(library.map((c) => [c.id, c])), [library]);
  const files = a.creativeIds.map((id) => byId.get(id)).filter((f): f is CreativeItem => Boolean(f));
  const pageName = account.pages.find((p) => p.id === a.pageId)?.name ?? "Your Page";
  const copy = { primaryTexts: a.primaryTexts.filter(Boolean), headlines: a.headlines.filter(Boolean), descriptions: a.descriptions.filter(Boolean), cta: a.cta, link: a.link };

  return (
    <div className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_260px]">
      <div className="grid content-start gap-4">
        <Issues node={a.key} issues={issues} />
        <Section title="Ad name" id="ad-name">
          <Input aria-label="Ad name" value={a.name} maxLength={400} onChange={(e) => set({ name: e.target.value })} />
        </Section>

        <Section title="Identity" id="ad-identity">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Facebook Page" htmlFor="page">
              <NativeSelect id="page" value={a.pageId} onChange={(e) => set({ pageId: e.target.value })}>
                {account.pages.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
                {!account.pages.some((p) => p.id === a.pageId) && <option value={a.pageId}>{a.pageId}</option>}
              </NativeSelect>
            </Field>
            <Field label="Instagram account" htmlFor="instagram">
              <NativeSelect id="instagram" value={a.instagramUserId ?? ""} onChange={(e) => set({ instagramUserId: e.target.value || null })}>
                <option value="">Use Facebook Page</option>
                {account.instagram.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          </div>
        </Section>

        <Section title="Ad setup" id="ad-setup">
          <Segmented name={`setup-${a.key}`} value={a.setup} onChange={(setup) => set({ setup })} options={[{ value: "create", label: "Create ad" }, { value: "existing_post", label: "Use existing post" }]} />
          {a.setup === "existing_post" && (
            <Field label="Post ID" htmlFor="post-id" hint="The post's ID from your Page (keeps its likes and comments).">
              <Input id="post-id" value={a.postId ?? ""} onChange={(e) => set({ postId: e.target.value.trim() })} />
            </Field>
          )}
          {a.setup === "create" && <p className="text-ui text-slate-11">Format: Single image or video.</p>}
        </Section>

        {a.setup === "create" && (
          <>
            <Section title="Ad creative" id="ad-creative" description="Add a 9:16 version for Stories and Reels and a 4:5 version for Feed; each placement gets the right one.">
              <div className="flex flex-wrap items-center gap-2">
                {files.map((f) => (
                  <span key={f.id} className="relative size-16 overflow-hidden rounded-control border border-slate-6 bg-slate-3">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={f.previewUrl} alt={f.fileName} className="size-full object-cover" />
                    <Badge className="absolute bottom-0.5 left-0.5 bg-black/60 text-white">{f.ratio ?? "?"}</Badge>
                  </span>
                ))}
                <Button onClick={() => setPicking(true)}>
                  <ImagePlus />
                  {files.length ? "Change media" : "Choose media"}
                </Button>
                <Button variant="ghost" onClick={onUpload}>
                  <Upload />
                  Upload
                </Button>
              </div>
              <TextOptions label="Primary text" values={a.primaryTexts} onChange={(primaryTexts) => set({ primaryTexts })} limit={COPY_LIMITS.primaryText} multiline />
              <TextOptions label="Headline" values={a.headlines} onChange={(headlines) => set({ headlines })} limit={COPY_LIMITS.headline} />
              <TextOptions label="Description" values={a.descriptions.length ? a.descriptions : [""]} onChange={(descriptions) => set({ descriptions })} limit={COPY_LIMITS.description} />
              <Field label="Call to action" htmlFor="cta">
                <NativeSelect id="cta" className="w-56" value={a.cta} onChange={(e) => set({ cta: e.target.value })}>
                  {CTA_TYPES.map((c) => (
                    <option key={c} value={c}>
                      {label(c)}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            </Section>

            <Section title="Destination" id="ad-destination">
              <Field label="Website URL" htmlFor="website-url">
                <Input id="website-url" type="url" value={a.link} onChange={(e) => set({ link: e.target.value })} aria-invalid={!a.link || undefined} />
              </Field>
              <Field label="Display link" htmlFor="display-link" hint="Optional: the link text shown in the ad instead of the URL.">
                <Input id="display-link" value={a.displayLink ?? ""} onChange={(e) => set({ displayLink: e.target.value || null })} />
              </Field>
              <Field label="URL parameters" htmlFor="url-tags" hint="Meta fills {{campaign.name}} and {{ad.name}} when the ad runs.">
                <Input id="url-tags" className="font-mono text-label" value={a.urlTags ?? ""} onChange={(e) => set({ urlTags: e.target.value || null })} />
              </Field>
            </Section>

            <Section title="Advantage+ creative" id="ad-enhancements" description="Optional enhancements Meta applies when they're likely to improve results.">
              <ul className="grid gap-x-6 sm:grid-cols-2">
                {CREATIVE_FEATURES.map((f) => (
                  <li key={f.key} className="flex h-10 items-center justify-between gap-3 border-b border-slate-6 text-ui">
                    <label htmlFor={`feature-${a.key}-${f.key}`} className="min-w-0 truncate">
                      {f.label}
                    </label>
                    <Switch id={`feature-${a.key}-${f.key}`} checked={a.features[f.key] === "OPT_IN"} onCheckedChange={(on) => set({ features: { ...a.features, [f.key]: on ? "OPT_IN" : "OPT_OUT" } })} />
                  </li>
                ))}
              </ul>
            </Section>
          </>
        )}
      </div>

      {a.setup === "create" && (
        <aside aria-label="Ad preview" className="grid content-start gap-3 2xl:sticky 2xl:top-0">
          <p className="text-label font-medium text-slate-11">Ad preview</p>
          <div className={cn("flex flex-wrap gap-3 2xl:flex-col")}>
            <PhonePreview placement="feed" files={files} copy={copy} pageName={pageName} />
            <PhonePreview placement="stories" files={files} copy={copy} pageName={pageName} />
          </div>
        </aside>
      )}

      <LibraryPicker
        open={picking}
        onOpenChange={setPicking}
        library={library}
        brandId={brandId}
        chosen={new Set()}
        onPick={(picked: LibraryGroup[]) => {
          const g = picked[0];
          if (g) set({ creativeIds: g.items.map((i) => i.id), name: a.name.match(/ ad \d+$/) ? g.key : a.name });
          setPicking(false);
        }}
      />
    </div>
  );
}

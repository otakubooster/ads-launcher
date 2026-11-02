"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CircleAlert, Rocket, X } from "lucide-react";
import { toast } from "sonner";
import { duplicateAd, duplicateAdset, editorHasErrors, newAd, newAdset, validateEditor, type EditorAd, type EditorAdset, type EditorDoc } from "@fahd/shared/editor";
import { formatMoney } from "@/lib/format";
import { publishEditor, saveEditor } from "@/app/(app)/create/actions";
import { UploadDialog } from "@/components/creatives/creatives-view";
import { LibraryPicker, type LibraryGroup } from "@/components/launch/creatives-step";
import { DeleteDraftButton } from "@/components/launch/delete-draft-button";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm";
import type { CreativeItem } from "@/lib/server/creatives";
import type { EditorData } from "@/lib/server/editor";
import { cn } from "@/lib/utils";
import { EditorTree, type Selection } from "./editor-tree";
import { AdForm, AdsetForm, CampaignForm } from "./forms";

const levelLabel = { campaign: "Campaign", adset: "Ad set", ad: "Ad" } as const;

/** Ads Manager's create/edit panel: structure on the left, the selected object's settings on the right. */
export function CampaignEditor({ data, library }: { data: EditorData; library: CreativeItem[] }) {
  const router = useRouter();
  const { confirm, dialog } = useConfirm();
  const [doc, setDoc] = React.useState<EditorDoc>(data.launch.doc);
  const [selected, setSelected] = React.useState<Selection>({ level: "campaign" });
  const [save, setSave] = React.useState<"saved" | "saving" | "error">("saved");
  const [publishing, startPublish] = React.useTransition();
  const [bulkFor, setBulkFor] = React.useState<string | null>(null);
  const [uploadFor, setUploadFor] = React.useState<{ s: string; a: string } | null>(null);
  const dirty = React.useRef(false);
  const version = React.useRef(0);
  // Set when the draft is being deleted, so a pending autosave doesn't report "Not saved".
  const deleted = React.useRef(false);
  const { defaults, account } = data;
  const currency = account.currency;

  const edit = React.useCallback((fn: (d: EditorDoc) => EditorDoc) => {
    dirty.current = true;
    version.current++;
    // "Saving…" in the same render as the edit, so "Draft saved" never shows for unsaved work.
    setSave("saving");
    setDoc(fn);
  }, []);

  // Autosave 600 ms after the last edit, like the bulk builder.
  React.useEffect(() => {
    if (!dirty.current) return;
    const v = version.current;
    const t = setTimeout(async () => {
      if (deleted.current) return;
      const res = await saveEditor(data.launch.id, doc);
      if (deleted.current) return;
      // A newer edit is still on its way: its own save sets the state.
      if (v !== version.current) return;
      setSave(res.ok ? "saved" : "error");
      if (!res.ok) toast.error(res.error.title, { description: res.error.detail });
    }, 600);
    return () => clearTimeout(t);
  }, [doc, data.launch.id]);

  // Warn before leaving with an edit that hasn't reached the server.
  React.useEffect(() => {
    if (save === "saved") return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [save]);

  const files = React.useMemo(() => Object.fromEntries(library.map((c) => [c.id, { ratio: c.ratio, kind: c.kind }])), [library]);
  const issues = React.useMemo(() => validateEditor(doc, files), [doc, files]);
  const errors = issues.filter((i) => i.level === "error").length;

  // Keep the selection valid when nodes go away.
  const adset = selected.level !== "campaign" ? doc.adsets.find((s) => s.key === selected.s) : undefined;
  const ad = selected.level === "ad" ? adset?.ads.find((a) => a.key === selected.a) : undefined;
  const current: Selection = selected.level === "ad" && !ad ? (adset ? { level: "adset", s: adset.key } : { level: "campaign" }) : selected.level === "adset" && !adset ? { level: "campaign" } : selected;

  const setAdset = (key: string, fn: (s: EditorAdset) => EditorAdset) => edit((d) => ({ ...d, adsets: d.adsets.map((s) => (s.key === key ? fn(s) : s)) }));
  const setAd = (sKey: string, aKey: string, fn: (a: EditorAd) => EditorAd) => setAdset(sKey, (s) => ({ ...s, ads: s.ads.map((a) => (a.key === aKey ? fn(a) : a)) }));

  function addAdset() {
    const s = newAdset(defaults, doc.adsets.length + 1);
    // New ad sets start like the last one, as Ads Manager's "Create ad set" does inside a campaign.
    const last = doc.adsets.at(-1);
    const next: EditorAdset = last ? { ...structuredClone(last), key: s.key, name: s.name, ads: s.ads } : s;
    edit((d) => ({ ...d, adsets: [...d.adsets, next] }));
    setSelected({ level: "adset", s: next.key });
  }

  function addAd(sKey: string) {
    const s = doc.adsets.find((x) => x.key === sKey);
    if (!s) return;
    if (s.ads.length >= 50) return toast.error("50 ads per ad set", { description: "Meta allows at most 50 ads in one ad set. Duplicate the ad set for more." });
    const fresh = newAd(defaults, s.ads.length + 1);
    const last = s.ads.at(-1);
    // Text, link and identity carry over from the last ad; media starts empty.
    const a: EditorAd = last ? { ...structuredClone(last), key: fresh.key, name: fresh.name, creativeIds: [], postId: null } : fresh;
    setAdset(sKey, (x) => ({ ...x, ads: [...x.ads, a] }));
    setSelected({ level: "ad", s: sKey, a: a.key });
  }

  function dupAdset(key: string) {
    const s = doc.adsets.find((x) => x.key === key);
    if (!s) return;
    const copy = duplicateAdset(s);
    edit((d) => {
      const i = d.adsets.findIndex((x) => x.key === key);
      return { ...d, adsets: [...d.adsets.slice(0, i + 1), copy, ...d.adsets.slice(i + 1)] };
    });
    setSelected({ level: "adset", s: copy.key });
    toast.success("Ad set duplicated", { description: `${s.ads.length} ${s.ads.length === 1 ? "ad" : "ads"} copied with it.` });
  }

  function dupAd(sKey: string, aKey: string) {
    const s = doc.adsets.find((x) => x.key === sKey);
    const a = s?.ads.find((x) => x.key === aKey);
    if (!s || !a) return;
    if (s.ads.length >= 50) return toast.error("50 ads per ad set", { description: "Meta allows at most 50 ads in one ad set." });
    const copy = duplicateAd(a);
    setAdset(sKey, (x) => {
      const i = x.ads.findIndex((y) => y.key === aKey);
      return { ...x, ads: [...x.ads.slice(0, i + 1), copy, ...x.ads.slice(i + 1)] };
    });
    setSelected({ level: "ad", s: sKey, a: copy.key });
  }

  async function deleteAdset(key: string) {
    const s = doc.adsets.find((x) => x.key === key);
    if (!s || doc.adsets.length <= 1) return;
    const ok = await confirm({ title: `Delete ${s.name || "this ad set"}?`, description: `Its ${s.ads.length} ${s.ads.length === 1 ? "ad goes" : "ads go"} too. Nothing has been created on Meta yet.`, confirmLabel: "Delete ad set", destructive: true });
    if (!ok) return;
    edit((d) => ({ ...d, adsets: d.adsets.filter((x) => x.key !== key) }));
    setSelected({ level: "campaign" });
  }

  async function deleteAd(sKey: string, aKey: string) {
    const s = doc.adsets.find((x) => x.key === sKey);
    const a = s?.ads.find((x) => x.key === aKey);
    if (!s || !a || s.ads.length <= 1) return;
    const ok = await confirm({ title: `Delete ${a.name || "this ad"}?`, description: "Nothing has been created on Meta yet.", confirmLabel: "Delete ad", destructive: true });
    if (!ok) return;
    setAdset(sKey, (x) => ({ ...x, ads: x.ads.filter((y) => y.key !== aKey) }));
    setSelected({ level: "adset", s: sKey });
  }

  /** One ad per library group (all ratios of one creative), text copied from the last ad. */
  function bulkAds(sKey: string, groups: LibraryGroup[]) {
    const s = doc.adsets.find((x) => x.key === sKey);
    if (!s || groups.length === 0) return;
    // A lone untouched ad (no media yet) is replaced, not kept as an empty extra.
    const keep = s.ads.length === 1 && s.ads[0]!.creativeIds.length === 0 && s.ads[0]!.setup === "create" ? [] : s.ads;
    const room = 50 - keep.length;
    const template = s.ads.at(-1) ?? newAd(defaults, 1);
    const used = new Set(keep.map((a) => a.name));
    const made = groups.slice(0, room).map((g, i) => {
      const fresh = newAd(defaults, keep.length + i + 1);
      const base = g.key.slice(0, 200) || fresh.name;
      let name = base;
      for (let n = 2; used.has(name); n++) name = `${base} ${n}`;
      used.add(name);
      return { ...structuredClone(template), key: fresh.key, name, setup: "create" as const, postId: null, creativeIds: g.items.map((c) => c.id) };
    });
    setAdset(sKey, (x) => ({ ...x, ads: [...keep, ...made] }));
    if (groups.length > room) toast.warning(`${groups.length - room} not added`, { description: "Meta allows 50 ads per ad set. Duplicate the ad set for the rest." });
    else toast.success(`${made.length} ${made.length === 1 ? "ad" : "ads"} created`, { description: "Primary text, headline and link were copied from the last ad." });
  }

  function publish() {
    if (editorHasErrors(issues)) {
      const first = issues.find((i) => i.level === "error")!;
      if (first.node === "campaign") setSelected({ level: "campaign" });
      else {
        const s = doc.adsets.find((x) => x.key === first.node || x.ads.some((a) => a.key === first.node));
        if (s) setSelected(s.key === first.node ? { level: "adset", s: s.key } : { level: "ad", s: s.key, a: first.node });
      }
      return toast.error("Fix the highlighted fields first", { description: first.message });
    }
    startPublish(async () => {
      // Flush any pending edit before the server reads the draft.
      const saved = await saveEditor(data.launch.id, doc);
      if (!saved.ok) return void toast.error(saved.error.title, { description: saved.error.detail });
      dirty.current = false;
      setSave("saved");
      const res = await publishEditor(data.launch.id);
      if (res && !res.ok) toast.error(res.error.title, { description: [res.error.detail, res.error.fix].filter(Boolean).join(" ") });
    });
  }

  const adCount = doc.adsets.reduce((n, s) => n + s.ads.length, 0);
  const daily = doc.campaign.campaignBudget ? (doc.campaign.budgetType === "daily" ? doc.campaign.budget : 0) : doc.adsets.reduce((n, s) => n + (s.budgetType === "daily" ? s.budget : 0), 0);
  const nodeIssues = (node: string) => issues.filter((i) => i.node === node);
  const bulkAdset = bulkFor ? doc.adsets.find((s) => s.key === bulkFor) : undefined;

  return (
    <div className="grid gap-4">
      {/* Top bar, like Ads Manager's editing header */}
      <div className="sticky -top-6 z-10 -mx-4 -mt-6 flex h-14 items-center gap-3 border-b border-slate-6 bg-slate-1 px-4 md:-mx-6 md:px-6 dark:bg-slate-2">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/launch" aria-label="Close editor">
            <X />
          </Link>
        </Button>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1">
            <p className="truncate text-body font-semibold">{doc.campaign.name || "New campaign"}</p>
            <DeleteDraftButton id={data.launch.id} name={doc.campaign.name} after="launch" onDeleting={() => (deleted.current = true)} />
          </div>
          <p className="truncate text-label text-slate-11">
            {account.name} · Sales · {doc.adsets.length} {doc.adsets.length === 1 ? "ad set" : "ad sets"} · {adCount} {adCount === 1 ? "ad" : "ads"}
            {daily > 0 && ` · ${formatMoney(daily, currency)}/day`}
          </p>
        </div>
        <span className="text-label text-slate-11" aria-live="polite">
          {save === "saving" ? "Saving…" : save === "error" ? "Not saved" : "Draft saved"}
        </span>
        {errors > 0 && (
          <span className="inline-flex items-center gap-1 text-label text-red-11">
            <CircleAlert className="size-3.5" /> {errors} to fix
          </span>
        )}
        <Button variant="primary" onClick={publish} disabled={publishing}>
          <Rocket /> {publishing ? "Publishing…" : "Publish"}
        </Button>
      </div>

      <div className="grid grid-cols-[280px_minmax(0,1fr)] items-start gap-6">
        <aside className="sticky top-[72px] max-h-[calc(100dvh-160px)] overflow-y-auto rounded-card border border-slate-6 p-2">
          <EditorTree
            doc={doc}
            selected={current}
            issues={issues}
            onSelect={setSelected}
            onAddAdset={addAdset}
            onAddAd={addAd}
            onDuplicateAdset={dupAdset}
            onDuplicateAd={dupAd}
            onDeleteAdset={deleteAdset}
            onDeleteAd={deleteAd}
          />
        </aside>

        <section aria-labelledby="editor-level" className="grid min-w-0 gap-4 pb-16">
          <div className="flex items-center gap-2">
            <h2 id="editor-level" className="text-label font-medium tracking-wide text-slate-11 uppercase">
              {levelLabel[current.level]}
            </h2>
            <span className={cn("text-label", current.level === "campaign" ? "hidden" : "text-slate-11")}>· everything is created paused</span>
          </div>
          {current.level === "campaign" && <CampaignForm c={doc.campaign} currency={currency} issues={nodeIssues("campaign")} onChange={(c) => edit((d) => ({ ...d, campaign: c }))} />}
          {current.level === "adset" && adset && (
            <AdsetForm
              key={adset.key}
              s={adset}
              campaign={doc.campaign}
              account={account}
              currency={currency}
              issues={nodeIssues(adset.key)}
              onChange={(next) => setAdset(adset.key, () => next)}
              onBulkAds={() => setBulkFor(adset.key)}
            />
          )}
          {current.level === "ad" && adset && ad && (
            <AdForm
              key={ad.key}
              a={ad}
              account={account}
              library={library}
              brandId={data.brandId}
              issues={nodeIssues(ad.key)}
              onChange={(next) => setAd(adset.key, ad.key, () => next)}
              onUpload={() => setUploadFor({ s: adset.key, a: ad.key })}
            />
          )}
        </section>
      </div>

      <LibraryPicker
        open={bulkFor !== null}
        onOpenChange={(o) => !o && setBulkFor(null)}
        library={library}
        brandId={data.brandId}
        brandName={data.brandName}
        chosen={new Set(bulkAdset?.ads.flatMap((a) => a.creativeIds.map((id) => library.find((c) => c.id === id)?.groupKey ?? id)) ?? [])}
        onPick={(groups) => {
          if (bulkFor) bulkAds(bulkFor, groups);
          setBulkFor(null);
        }}
      />
      <UploadDialog
        open={uploadFor !== null}
        onOpenChange={(o) => !o && setUploadFor(null)}
        brands={[{ id: data.brandId, name: data.brandName }]}
        onDone={(saved) => {
          if (uploadFor) setAd(uploadFor.s, uploadFor.a, (a) => ({ ...a, setup: "create", creativeIds: [...new Set([...a.creativeIds, ...saved.map((f) => f.id)])] }));
          setUploadFor(null);
          router.refresh();
        }}
      />
      {dialog}
    </div>
  );
}

"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, CloudUpload, Film, Images, Rocket, Tag, Trash2, TriangleAlert, Upload } from "lucide-react";
import { toast } from "sonner";
import { deleteCreatives, finishUpload, prepareUpload, updateTags, uploadToAccounts, type FileInput } from "@/app/(app)/creatives/actions";
import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Field, Input, NativeSelect } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { EMPTY, formatMoney, formatPercent, formatRoas } from "@/lib/format";
import type { ActionResult } from "@/lib/server/action-result";
import type { CreativeItem, CreativePerf } from "@/lib/server/creatives";
import { cn } from "@/lib/utils";
import { groupKey, pairCreatives, ratioOf, validateCreative, type Issue, type Ratio } from "@fahd/shared/creatives";
import { putWithProgress, readMeta, sha256File } from "./upload-client";

type Option = { id: string; name: string };

type Group = { key: string; brandId: string; brandName: string; items: CreativeItem[]; ratios: string[]; lead: CreativeItem; perf: CreativePerf | null; createdAt: string };

const BANDS = {
  any: "Any performance",
  none: "Not launched",
  low: "ROAS under 1",
  mid: "ROAS 1–2",
  high: "ROAS 2+",
} as const;

function report(res: ActionResult<unknown>) {
  if (res.ok) toast.success(res.message ?? "Done");
  else toast.error(res.error.title, { description: [res.error.detail, res.error.fix].filter(Boolean).join(" ") });
}

export function CreativesView({
  items,
  perf,
  currency,
  brands,
  accounts,
  canEdit,
}: {
  items: CreativeItem[];
  perf: Record<string, CreativePerf>;
  currency: string;
  brands: Option[];
  accounts: Option[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const { confirm, dialog } = useConfirm();
  const [brand, setBrand] = React.useState("");
  const [tag, setTag] = React.useState("");
  const [ratio, setRatio] = React.useState("");
  const [band, setBand] = React.useState<keyof typeof BANDS>("any");
  const [added, setAdded] = React.useState("");
  const [search, setSearch] = React.useState("");
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [uploadOpen, setUploadOpen] = React.useState(false);
  const [tagOpen, setTagOpen] = React.useState(false);
  const [busy, start] = React.useTransition();
  const [now] = React.useState(() => Date.now());

  const groups = React.useMemo<Group[]>(() => {
    const map = new Map<string, CreativeItem[]>();
    for (const i of items) map.set(`${i.brandId}:${i.groupKey}`, [...(map.get(`${i.brandId}:${i.groupKey}`) ?? []), i]);
    return [...map.values()].map((list) => {
      const lead = list.find((i) => i.ratio === "4:5") ?? list.find((i) => i.ratio === "1:1") ?? list[0]!;
      const p = list.reduce<CreativePerf | null>((acc, i) => {
        const x = perf[i.id];
        if (!x) return acc;
        return { spend: (acc?.spend ?? 0) + x.spend, value: (acc?.value ?? 0) + x.value, plays: (acc?.plays ?? 0) + x.plays, impressions: (acc?.impressions ?? 0) + x.impressions, ads: (acc?.ads ?? 0) + x.ads };
      }, null);
      return {
        key: `${lead.brandId}:${lead.groupKey}`,
        brandId: lead.brandId,
        brandName: lead.brandName,
        items: list,
        ratios: [...new Set(list.map((i) => i.ratio).filter((r): r is string => Boolean(r)))],
        lead,
        perf: p,
        createdAt: list.map((i) => i.createdAt).sort().at(-1)!,
      };
    });
  }, [items, perf]);

  const tags = React.useMemo(() => [...new Set(items.flatMap((i) => [i.tags.angle, i.tags.hook].filter((t): t is string => Boolean(t))))].sort(), [items]);

  const visible = groups.filter((g) => {
    if (brand && g.brandId !== brand) return false;
    if (ratio && !g.ratios.includes(ratio)) return false;
    if (tag && !g.items.some((i) => i.tags.angle === tag || i.tags.hook === tag)) return false;
    if (search && !g.lead.groupKey.includes(search.toLowerCase()) && !g.items.some((i) => i.fileName.toLowerCase().includes(search.toLowerCase()))) return false;
    if (added && now - new Date(g.createdAt).getTime() > Number(added) * 86_400_000) return false;
    const roas = g.perf && g.perf.spend ? g.perf.value / g.perf.spend : null;
    if (band === "none" && g.perf) return false;
    if (band === "low" && !(roas !== null && roas < 1)) return false;
    if (band === "mid" && !(roas !== null && roas >= 1 && roas < 2)) return false;
    if (band === "high" && !(roas !== null && roas >= 2)) return false;
    return true;
  });

  const selectedIds = groups.filter((g) => selected.has(g.key)).flatMap((g) => g.items.map((i) => i.id));
  const toggle = (key: string) => setSelected((s) => (s.has(key) ? new Set([...s].filter((k) => k !== key)) : new Set([...s, key])));

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Input data-filter-input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search file names" aria-label="Search" className="w-56" />
        <NativeSelect aria-label="Brand" value={brand} onChange={(e) => setBrand(e.target.value)} className="w-36">
          <option value="">All brands</option>
          {brands.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect aria-label="Tag" value={tag} onChange={(e) => setTag(e.target.value)} className="w-36">
          <option value="">All tags</option>
          {tags.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect aria-label="Ratio" value={ratio} onChange={(e) => setRatio(e.target.value)} className="w-28">
          <option value="">Any ratio</option>
          {["9:16", "4:5", "1:1", "16:9"].map((r) => (
            <option key={r}>{r}</option>
          ))}
        </NativeSelect>
        <NativeSelect aria-label="Performance" value={band} onChange={(e) => setBand(e.target.value as keyof typeof BANDS)} className="w-40">
          {Object.entries(BANDS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect aria-label="Date added" value={added} onChange={(e) => setAdded(e.target.value)} className="w-32">
          <option value="">Any time</option>
          <option value="7">Last 7 days</option>
          <option value="30">Last 30 days</option>
        </NativeSelect>
        {canEdit && (
          <Button variant="primary" className="ml-auto" onClick={() => setUploadOpen(true)}>
            <Upload />
            Upload creatives
          </Button>
        )}
      </div>

      {items.length === 0 ? (
        <EmptyState
          icon={Images}
          title="No creatives yet"
          description="Upload images and videos once; 9:16 and 4:5 versions pair automatically by file name."
          action={
            canEdit && (
              <Button variant="primary" onClick={() => setUploadOpen(true)}>
                Upload creatives
              </Button>
            )
          }
        />
      ) : visible.length === 0 ? (
        <p className="py-12 text-center text-body text-slate-11">No creatives match these filters.</p>
      ) : (
        <ul aria-label="Creatives" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
          {visible.map((g) => (
            <CreativeCard key={g.key} group={g} currency={currency} selected={selected.has(g.key)} onToggle={() => toggle(g.key)} selectable={canEdit} />
          ))}
        </ul>
      )}

      {selected.size > 0 && canEdit && (
        <div role="toolbar" aria-label="Selected creatives" className="fixed bottom-6 left-1/2 z-40 flex -translate-x-1/2 items-center gap-1 rounded-card border border-slate-6 bg-slate-1 p-1.5 shadow-float dark:bg-slate-2">
          <span className="px-2 text-ui font-medium tabular-nums">{selected.size} selected</span>
          <Button size="sm" variant="ghost" asChild>
            <Link href={`/launch?creatives=${selectedIds.join(",")}`}>
              <Rocket />
              Launch with selected
            </Link>
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="ghost" disabled={busy || accounts.length === 0}>
                <CloudUpload />
                Upload to Meta
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="center">
              <DropdownMenuLabel>Ad account</DropdownMenuLabel>
              {accounts.map((a) => (
                <DropdownMenuItem key={a.id} onSelect={() => start(async () => (report(await uploadToAccounts(selectedIds, [a.id])), router.refresh()))}>
                  {a.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button size="sm" variant="ghost" onClick={() => setTagOpen(true)}>
            <Tag />
            Tag
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={async () => {
              const n = selectedIds.length;
              if (!(await confirm({ title: `Delete ${n} ${n === 1 ? "file" : "files"}?`, description: "They leave the library and storage. Ads already on Meta keep running.", confirmLabel: "Delete", destructive: true }))) return;
              start(async () => {
                report(await deleteCreatives(selectedIds));
                setSelected(new Set());
                router.refresh();
              });
            }}
          >
            <Trash2 />
            Delete
          </Button>
        </div>
      )}

      <UploadDialog open={uploadOpen} onOpenChange={setUploadOpen} brands={brands} onDone={() => router.refresh()} />
      {dialog}
      <TagDialog
        open={tagOpen}
        onOpenChange={setTagOpen}
        onSave={(t) =>
          start(async () => {
            const res = await updateTags(selectedIds, t);
            report(res);
            if (res.ok) {
              setTagOpen(false);
              router.refresh();
            }
          })
        }
      />
    </>
  );
}

function CreativeCard({ group: g, currency, selected, onToggle, selectable }: { group: Group; currency: string; selected: boolean; onToggle: () => void; selectable: boolean }) {
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const isVideo = g.lead.kind === "video";
  const roas = g.perf && g.perf.spend ? g.perf.value / g.perf.spend : null;
  const hook = g.perf && g.perf.impressions ? g.perf.plays / g.perf.impressions : null;
  const ready = new Set(g.items.flatMap((i) => i.uploads.filter((u) => u.status === "ready").map((u) => u.adAccountId))).size;

  return (
    <li className={cn("group relative overflow-hidden rounded-card border", selected ? "border-iris-8 ring-1 ring-iris-8" : "border-slate-6 hover:border-slate-8")}>
      {selectable && (
        <label className="absolute top-2 left-2 z-10 flex size-7 items-center justify-center rounded-control bg-slate-1/90 dark:bg-slate-2/90">
          <Checkbox checked={selected} onChange={onToggle} aria-label={`Select ${g.lead.groupKey}`} />
        </label>
      )}
      <Link href={`/creatives/${g.lead.id}`} className="block">
        <div
          className="relative aspect-[4/5] bg-slate-3"
          onMouseEnter={() => void videoRef.current?.play().catch(() => {})}
          onMouseLeave={() => {
            if (videoRef.current) {
              videoRef.current.pause();
              videoRef.current.currentTime = 0;
            }
          }}
        >
          {isVideo ? (
            <video ref={videoRef} src={g.lead.mediaUrl} poster={g.lead.previewUrl !== g.lead.mediaUrl ? g.lead.previewUrl : undefined} muted loop playsInline preload="none" className="size-full object-cover" />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={g.lead.previewUrl} alt="" loading="lazy" className="size-full object-cover" />
          )}
          <div className="absolute right-2 bottom-2 flex gap-1">
            {g.ratios.map((r) => (
              <Badge key={r} className="bg-black/60 text-white">
                {r}
              </Badge>
            ))}
            {isVideo && g.lead.durationS !== null && (
              <Badge className="bg-black/60 text-white">
                <Film className="size-3" />
                {Math.round(g.lead.durationS)}s
              </Badge>
            )}
          </div>
        </div>
        <div className="grid gap-1 px-2.5 py-2">
          <p className="truncate text-ui font-medium">{g.lead.groupKey}</p>
          <p className="truncate text-label text-slate-11">
            {g.brandName}
            {g.items.length > 1 ? ` · ${g.items.length} files` : ""}
            {ready ? ` · in ${ready} ${ready === 1 ? "account" : "accounts"}` : ""}
          </p>
          {(g.lead.tags.angle || g.lead.tags.hook) && (
            <p className="flex flex-wrap gap-1">
              {[g.lead.tags.angle, g.lead.tags.hook].filter(Boolean).map((t) => (
                <Badge key={t} tone="accent">
                  {t}
                </Badge>
              ))}
            </p>
          )}
          <p className="flex justify-between text-label text-slate-11 tabular-nums">
            {g.perf ? (
              <>
                <span>{formatMoney(g.perf.spend, currency)}</span>
                <span>{formatRoas(roas)}</span>
                <span>Hook {hook === null ? EMPTY : formatPercent(hook)}</span>
              </>
            ) : (
              <span>Not launched yet</span>
            )}
          </p>
        </div>
      </Link>
    </li>
  );
}

type Row = {
  key: string;
  file: File;
  status: "reading" | "hashing" | "uploading" | "saving" | "done" | "duplicate" | "error";
  progress: number;
  ratio: Ratio | null;
  groupKey: string;
  issues: Issue[];
  error?: string;
};

const STATUS_LABEL: Record<Row["status"], string> = {
  reading: "Reading",
  hashing: "Checking",
  uploading: "Uploading",
  saving: "Saving",
  done: "Ready",
  duplicate: "Already in library",
  error: "Failed",
};

/** Drop files or a folder; each is measured, hashed, uploaded straight to storage, then saved. */
export function UploadDialog({
  open,
  onOpenChange,
  brands,
  onDone,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  brands: Option[];
  onDone: (saved: { id: string; groupKey: string }[]) => void;
}) {
  const [picked, setBrandId] = React.useState(brands[0]?.id ?? "");
  // The launch builder passes only the preset's brand, which can change while mounted.
  const brandId = brands.some((b) => b.id === picked) ? picked : (brands[0]?.id ?? "");
  const [rows, setRows] = React.useState<Row[]>([]);
  const [dragging, setDragging] = React.useState(false);
  const patch = (key: string, p: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...p } : r)));

  async function processFile(row: Row): Promise<string | null> {
    const { file } = row;
    try {
      const meta = await readMeta(file);
      const ratio = ratioOf(meta.width, meta.height);
      const issues = validateCreative({ fileName: file.name, kind: meta.kind, width: meta.width, height: meta.height, durationS: meta.durationS, sizeBytes: file.size });
      patch(row.key, { ratio, issues, status: "hashing" });
      if (issues.some((i) => i.level === "error")) return void patch(row.key, { status: "error", error: issues.find((i) => i.level === "error")!.message }), null;
      const sha256 = await sha256File(file, (f) => patch(row.key, { progress: f }));
      const input: FileInput = {
        brandId,
        fileName: file.name,
        contentType: file.type || (meta.kind === "video" ? "video/mp4" : "image/jpeg"),
        sizeBytes: file.size,
        sha256,
        kind: meta.kind,
        width: meta.width,
        height: meta.height,
        durationS: meta.durationS,
        hasPoster: meta.poster !== null,
      };
      const prepared = await prepareUpload(input);
      if (!prepared.ok) return void patch(row.key, { status: "error", error: `${prepared.error.title}: ${prepared.error.detail}` }), null;
      const p = prepared.data!;
      if ("duplicateOf" in p) return void patch(row.key, { status: "duplicate", progress: 1 }), p.duplicateOf;
      patch(row.key, { status: "uploading", progress: 0 });
      await putWithProgress(p.upload.url, file, p.upload.headers, (f) => patch(row.key, { progress: f }));
      if (p.poster && meta.poster) await putWithProgress(p.poster.url, meta.poster, p.poster.headers, () => {});
      patch(row.key, { status: "saving" });
      const saved = await finishUpload({ ...input, id: p.id, storagePath: p.storagePath, posterPath: p.poster?.path ?? null });
      patch(row.key, saved.ok ? { status: "done", progress: 1 } : { status: "error", error: saved.error.detail });
      return saved.ok ? (saved.data?.id ?? null) : null;
    } catch (e) {
      patch(row.key, { status: "error", error: e instanceof Error ? e.message : String(e) });
      return null;
    }
  }

  async function addFiles(list: FileList | File[]) {
    const files = [...list].filter((f) => f.type.startsWith("image/") || f.type.startsWith("video/"));
    const added = files.map<Row>((file) => ({ key: `${file.name}-${file.size}-${file.lastModified}`, file, status: "reading", progress: 0, ratio: null, groupKey: groupKey(file.name), issues: [] }));
    setRows((rs) => [...rs.filter((r) => !added.some((a) => a.key === r.key)), ...added]);
    // Two at a time: fast enough, and gentle on memory for large videos.
    const queue = [...added];
    const saved: { id: string; groupKey: string }[] = [];
    await Promise.all(
      [0, 1].map(async () => {
        for (let next = queue.shift(); next; next = queue.shift()) {
          const id = await processFile(next);
          if (id) saved.push({ id, groupKey: next.groupKey });
        }
      }),
    );
    onDone(saved);
  }

  const groups = pairCreatives(rows.filter((r) => r.status !== "error"));
  const allDone = rows.length > 0 && rows.every((r) => ["done", "duplicate", "error"].includes(r.status));

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setRows([]);
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Upload creatives</DialogTitle>
          <DialogDescription>Files sharing a name stem pair automatically: hook3_9x16.mp4 + hook3_4x5.mp4 become one creative.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 px-5 py-4">
          <Field label="Brand" htmlFor="upload-brand">
            <NativeSelect id="upload-brand" value={brandId} onChange={(e) => setBrandId(e.target.value)}>
              {brands.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <label
            onDragOver={(e) => (e.preventDefault(), setDragging(true))}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              void addFiles(e.dataTransfer.files);
            }}
            className={cn("flex cursor-pointer flex-col items-center justify-center gap-1 rounded-card border border-dashed px-4 py-8 text-center", dragging ? "border-iris-8 bg-iris-2" : "border-slate-7 hover:bg-slate-2")}
          >
            <Upload className="size-5 text-slate-11" />
            <span className="text-body font-medium">Drop images and videos, or choose files</span>
            <span className="text-ui text-slate-11">MP4, MOV, JPG, PNG · videos up to 4 GB</span>
            <input type="file" multiple accept="image/*,video/*" className="sr-only" aria-label="Choose files" onChange={(e) => e.target.files && void addFiles(e.target.files)} />
          </label>

          {rows.length > 0 && (
            <ul className="grid max-h-72 gap-2 overflow-y-auto" aria-label="Upload progress">
              {rows.map((r) => (
                <li key={r.key} className="grid gap-1 rounded-control border border-slate-6 px-3 py-2">
                  <div className="flex items-center gap-2 text-ui">
                    <span className="min-w-0 flex-1 truncate font-medium">{r.file.name}</span>
                    {r.ratio && <Badge>{r.ratio}</Badge>}
                    <span className={cn("shrink-0", r.status === "error" ? "text-red-11" : r.status === "done" ? "text-grass-11" : "text-slate-11")}>
                      {r.status === "done" && <Check className="mr-1 inline size-3.5" />}
                      {STATUS_LABEL[r.status]}
                      {(r.status === "uploading" || r.status === "hashing") && ` ${Math.round(r.progress * 100)}%`}
                    </span>
                  </div>
                  {(r.status === "uploading" || r.status === "hashing") && <Progress value={r.progress * 100} indicatorClassName="bg-iris-9" aria-label={`${r.file.name} progress`} />}
                  {r.error && <p className="text-label text-red-11">{r.error}</p>}
                  {r.issues
                    .filter((i) => i.level === "warning")
                    .map((i) => (
                      <p key={i.message} className="flex items-center gap-1 text-label text-amber-11">
                        <TriangleAlert className="size-3" />
                        {i.message}
                      </p>
                    ))}
                </li>
              ))}
            </ul>
          )}

          {groups.length > 0 && (
            <div className="grid gap-1" aria-label="Pairing">
              <p className="text-label font-medium text-slate-11">Pairing</p>
              {groups.map((g) => (
                <p key={g.key} className={cn("text-ui", g.paired ? "text-slate-12" : "text-amber-11")}>
                  {g.key}: {g.ratios.join(" + ") || "unknown ratio"}
                  {g.paired ? " · paired for Stories/Reels and Feed" : " · unpaired: add a 9:16 and a 4:5 version to cover every placement"}
                </p>
              ))}
            </div>
          )}

          <div className="flex justify-end">
            <Button variant={allDone ? "primary" : "secondary"} onClick={() => onOpenChange(false)}>
              {allDone ? "Done" : "Close"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function TagDialog({ open, onOpenChange, onSave }: { open: boolean; onOpenChange: (o: boolean) => void; onSave: (tags: { angle?: string; hook?: string }) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Tag creatives</DialogTitle>
          <DialogDescription>Angle and hook feed naming templates and creative reports.</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-3 px-5 py-4"
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            onSave({ angle: String(fd.get("angle") ?? ""), hook: String(fd.get("hook") ?? "") });
          }}
        >
          <Field label="Angle" htmlFor="tag-angle">
            <Input id="tag-angle" name="angle" placeholder="glow" />
          </Field>
          <Field label="Hook" htmlFor="tag-hook">
            <Input id="tag-hook" name="hook" placeholder="morning routine" />
          </Field>
          <div className="flex justify-end gap-2">
            <Button onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" variant="primary">
              Save tags
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CloudUpload, Film, ImagePlus, Images, Trash2, TriangleAlert, Upload } from "lucide-react";
import { toast } from "sonner";
import { updateTags, uploadToAccounts } from "@/app/(app)/creatives/actions";
import { UploadDialog } from "@/components/creatives/creatives-view";
import { EmptyState } from "@/components/empty-state";
import { Badge, StatusDot } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { CreativeItem } from "@/lib/server/creatives";
import { cn } from "@/lib/utils";
import type { DraftCreativeGroup } from "@fahd/shared/launch-plan";
import type { StepProps } from "./builder";

type LibraryGroup = { key: string; items: CreativeItem[]; lead: CreativeItem; ratios: string[] };

const RATIO_ORDER = ["9:16", "4:5", "1:1", "16:9"];

export function libraryGroups(library: CreativeItem[], brandId?: string): LibraryGroup[] {
  const map = new Map<string, CreativeItem[]>();
  for (const c of library) {
    if (brandId && c.brandId !== brandId) continue;
    map.set(c.groupKey, [...(map.get(c.groupKey) ?? []), c]);
  }
  return [...map].map(([key, items]) => {
    const sorted = [...items].sort((a, b) => RATIO_ORDER.indexOf(a.ratio ?? "") - RATIO_ORDER.indexOf(b.ratio ?? ""));
    return { key, items: sorted, lead: sorted[0]!, ratios: sorted.map((i) => i.ratio ?? "?") };
  });
}

/** Meta media library state for this account: every file must be ready before ads attach to it. */
function metaState(items: CreativeItem[], accountId: string): { tone: "positive" | "info" | "negative" | "neutral"; label: string } {
  const states = items.map((i) => i.uploads.find((u) => u.adAccountId === accountId)?.status);
  if (states.some((s) => s === "error")) return { tone: "negative", label: "Upload failed" };
  if (states.every((s) => s === "ready")) return { tone: "positive", label: "Ready in Meta" };
  if (states.some((s) => s === "uploading" || s === "processing" || s === "pending")) return { tone: "info", label: "Processing" };
  return { tone: "neutral", label: "Uploads at launch" };
}

export function CreativesStep({ data, library, draft, update }: StepProps) {
  const router = useRouter();
  const [picking, setPicking] = React.useState(false);
  const [uploading, setUploading] = React.useState(false);
  const [sending, setSending] = React.useState(false);
  const byId = React.useMemo(() => new Map(library.map((c) => [c.id, c])), [library]);
  const groups = draft.creatives.groups;

  const setGroups = React.useCallback(
    (fn: (gs: DraftCreativeGroup[]) => DraftCreativeGroup[]) => update((d) => ({ ...d, creatives: { groups: fn(d.creatives.groups) } })),
    [update],
  );

  const addLibraryGroups = React.useCallback(
    (picked: LibraryGroup[]) =>
      setGroups((gs) => {
        const out = [...gs];
        for (const g of picked) {
          const existing = out.findIndex((x) => x.key === g.key);
          const entry: DraftCreativeGroup = { key: g.key, creativeIds: g.items.map((i) => i.id), angle: g.lead.tags.angle, hook: g.lead.tags.hook ?? g.key, format: g.lead.tags.format };
          if (existing >= 0) out[existing] = { ...out[existing]!, creativeIds: entry.creativeIds };
          else out.push(entry);
        }
        return out;
      }),
    [setGroups],
  );

  const ids = groups.flatMap((g) => g.creativeIds);
  const notReady = ids.filter((id) => byId.get(id)?.uploads.find((u) => u.adAccountId === data.preset.accountId)?.status !== "ready");

  async function sendToMeta() {
    setSending(true);
    const res = await uploadToAccounts(notReady, [data.preset.accountId]);
    setSending(false);
    if (res.ok) toast.success(res.message ?? "Uploading to Meta");
    else toast.error(res.error.title, { description: res.error.detail });
    router.refresh();
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => setPicking(true)}>
          <Images /> Pick from library
        </Button>
        <Button onClick={() => setUploading(true)}>
          <Upload /> Upload files
        </Button>
        {groups.length > 0 && notReady.length > 0 && (
          <Button variant="ghost" onClick={sendToMeta} disabled={sending}>
            <CloudUpload /> {sending ? "Sending…" : `Send ${notReady.length} ${notReady.length === 1 ? "file" : "files"} to Meta now`}
          </Button>
        )}
        <p className="ml-auto text-label text-slate-11">Files sharing a name stem pair: hook3_9x16.mp4 + hook3_4x5.mp4 = one creative.</p>
      </div>

      {groups.length === 0 ? (
        <EmptyState
          icon={ImagePlus}
          title="No creatives yet"
          description="Pick creatives from the library or drop new files. Each becomes one ad, with every ratio placed where it fits."
          action={
            <Button variant="primary" onClick={() => setPicking(true)}>
              Pick from library
            </Button>
          }
          className="min-h-60"
        />
      ) : (
        <div className="overflow-hidden rounded-card border border-slate-6">
          <table className="w-full text-ui">
            <thead className="bg-slate-2 text-label text-slate-11">
              <tr className="h-8 text-left">
                <th className="w-16 px-3 font-medium">
                  <span className="sr-only">Preview</span>
                </th>
                <th className="px-3 font-medium">Creative</th>
                <th className="w-32 px-3 font-medium">Angle</th>
                <th className="w-32 px-3 font-medium">Hook</th>
                <th className="w-36 px-3 font-medium">Meta</th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {groups.map((g, i) => {
                const files = g.creativeIds
                  .map((id) => byId.get(id))
                  .filter((c): c is CreativeItem => Boolean(c))
                  .sort((a, b) => RATIO_ORDER.indexOf(a.ratio ?? "") - RATIO_ORDER.indexOf(b.ratio ?? ""));
                const lead = files[0];
                const ratios = files.map((f) => f.ratio ?? "?");
                const unpaired = !ratios.includes("9:16") || !(ratios.includes("4:5") || ratios.includes("1:1"));
                const state = metaState(files, data.preset.accountId);
                const patch = (p: Partial<DraftCreativeGroup>) => setGroups((gs) => gs.map((x, j) => (j === i ? { ...x, ...p } : x)));
                const persist = () => files.length && void updateTags(g.creativeIds, { ...lead?.tags, angle: g.angle, hook: g.hook });
                return (
                  <tr key={g.key} className="border-t border-slate-6 align-middle">
                    <td className="px-3 py-2">
                      <div className="relative size-10 overflow-hidden rounded-control bg-slate-3">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        {lead && <img src={lead.previewUrl} alt="" className="size-full object-cover" />}
                        {lead?.kind === "video" && <Film className="absolute right-0.5 bottom-0.5 size-3 text-white drop-shadow" />}
                      </div>
                    </td>
                    <td className="min-w-0 px-3 py-2">
                      <p className="truncate font-medium">{g.key}</p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-1">
                        {ratios.map((r) => (
                          <Badge key={r}>{r}</Badge>
                        ))}
                        {files.length === 0 && <span className="text-label text-red-11">Missing from the library</span>}
                        {files.length > 0 && unpaired && (
                          <span className="inline-flex items-center gap-1 text-label whitespace-nowrap text-amber-11">
                            <TriangleAlert className="size-3" />
                            {ratios.includes("9:16") ? "No 4:5 for Feed" : "No 9:16 for Stories, Reels"}
                          </span>
                        )}
                      </p>
                    </td>
                    <td className="px-3 py-2">
                      <Input aria-label={`Angle for ${g.key}`} value={g.angle ?? ""} placeholder="e.g. pain" onChange={(e) => patch({ angle: e.target.value || undefined })} onBlur={persist} />
                    </td>
                    <td className="px-3 py-2">
                      <Input aria-label={`Hook for ${g.key}`} value={g.hook ?? ""} placeholder={g.key} onChange={(e) => patch({ hook: e.target.value || undefined })} onBlur={persist} />
                    </td>
                    <td className="px-3 py-2">
                      <StatusDot tone={state.tone} label={state.label} />
                    </td>
                    <td className="px-1">
                      <Button variant="ghost" size="icon-sm" aria-label={`Remove ${g.key}`} onClick={() => setGroups((gs) => gs.filter((_, j) => j !== i))}>
                        <Trash2 />
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <LibraryPicker
        open={picking}
        onOpenChange={setPicking}
        groups={libraryGroups(library, data.preset.brandId)}
        chosen={new Set(groups.map((g) => g.key))}
        onPick={(picked) => {
          addLibraryGroups(picked);
          setPicking(false);
        }}
      />
      <UploadDialog
        open={uploading}
        onOpenChange={setUploading}
        brands={[{ id: data.preset.brandId, name: data.preset.brandName }]}
        onDone={(saved) => {
          // Uploaded files join the launch right away; the refresh brings their previews.
          setGroups((gs) => {
            const out = [...gs];
            for (const f of saved) {
              const i = out.findIndex((g) => g.key === f.groupKey);
              if (i < 0) out.push({ key: f.groupKey, creativeIds: [f.id], hook: f.groupKey });
              else if (!out[i]!.creativeIds.includes(f.id)) out[i] = { ...out[i]!, creativeIds: [...out[i]!.creativeIds, f.id] };
            }
            return out;
          });
          router.refresh();
        }}
      />
    </div>
  );
}

function LibraryPicker({
  open,
  onOpenChange,
  groups,
  chosen,
  onPick,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  groups: LibraryGroup[];
  chosen: Set<string>;
  onPick: (g: LibraryGroup[]) => void;
}) {
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [query, setQuery] = React.useState("");
  const shown = groups.filter((g) => !query || g.key.toLowerCase().includes(query.toLowerCase()) || Object.values(g.lead.tags).some((t) => t?.toLowerCase().includes(query.toLowerCase())));

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setSelected(new Set());
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Pick creatives</DialogTitle>
          <DialogDescription>Creatives for this preset&apos;s brand. Paired ratios come along together.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 px-5 py-4">
          <Input placeholder="Search by name, angle or hook" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search creatives" />
          {shown.length === 0 ? (
            <p className="py-10 text-center text-body text-slate-11">{groups.length ? "Nothing matches." : "The library has no creatives for this brand yet. Upload some first."}</p>
          ) : (
            <ul className="grid max-h-[420px] grid-cols-4 gap-3 overflow-y-auto p-0.5">
              {shown.map((g) => {
                const on = selected.has(g.key);
                const already = chosen.has(g.key);
                return (
                  <li key={g.key}>
                    <label className={cn("block overflow-hidden rounded-card border", on ? "border-iris-8 ring-1 ring-iris-8" : "border-slate-6 hover:border-slate-8", already && "opacity-60")}>
                      <div className="relative aspect-[4/5] bg-slate-3">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={g.lead.previewUrl} alt="" loading="lazy" className="size-full object-cover" />
                        <span className="absolute top-2 left-2 flex size-6 items-center justify-center rounded-control bg-slate-1/90 dark:bg-slate-2/90">
                          <Checkbox
                            checked={on || already}
                            disabled={already}
                            aria-label={`Select ${g.key}`}
                            onChange={() => setSelected((s) => (s.has(g.key) ? new Set([...s].filter((k) => k !== g.key)) : new Set(s).add(g.key)))}
                          />
                        </span>
                        <span className="absolute right-2 bottom-2 flex gap-1">
                          {g.ratios.map((r) => (
                            <Badge key={r} className="bg-black/60 text-white">
                              {r}
                            </Badge>
                          ))}
                        </span>
                      </div>
                      <p className="truncate px-2 py-1.5 text-ui font-medium">{g.key}</p>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button variant="primary" disabled={selected.size === 0} onClick={() => {
                onPick(groups.filter((g) => selected.has(g.key)));
                setSelected(new Set());
              }}>
              Add {selected.size || ""} {selected.size === 1 ? "creative" : "creatives"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

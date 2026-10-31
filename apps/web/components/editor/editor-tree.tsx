"use client";

import { Copy, Image as ImageIcon, LayoutGrid, Megaphone, MoreHorizontal, Plus, Trash2 } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { EditorDoc, EditorIssue } from "@fahd/shared/editor";

export type Selection = { level: "campaign" } | { level: "adset"; s: string } | { level: "ad"; s: string; a: string };

type Props = {
  doc: EditorDoc;
  selected: Selection;
  issues: EditorIssue[];
  onSelect: (s: Selection) => void;
  onAddAdset: () => void;
  onAddAd: (adsetKey: string) => void;
  onDuplicateAdset: (key: string) => void;
  onDuplicateAd: (adsetKey: string, adKey: string) => void;
  onDeleteAdset: (key: string) => void;
  onDeleteAd: (adsetKey: string, adKey: string) => void;
};

function Dot({ node, issues }: { node: string; issues: EditorIssue[] }) {
  const mine = issues.filter((i) => i.node === node);
  if (mine.some((i) => i.level === "error")) return <span role="img" className="size-2 shrink-0 rounded-full bg-red-9" aria-label="needs fixing" />;
  if (mine.length) return <span role="img" className="size-2 shrink-0 rounded-full bg-amber-9" aria-label="has warnings" />;
  return null;
}

function NodeMenu({ label, onDuplicate, onDelete, canDelete }: { label: string; onDuplicate: () => void; onDelete: () => void; canDelete: boolean }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" aria-label={`More for ${label}`} onClick={(e) => e.stopPropagation()} className="inline-flex size-7 shrink-0 items-center justify-center rounded-control text-slate-11 opacity-0 group-hover/node:opacity-100 hover:bg-slate-4 hover:text-slate-12 focus-visible:opacity-100 data-[state=open]:opacity-100">
          <MoreHorizontal className="size-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={onDuplicate}>
          <Copy />
          Duplicate
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onDelete} disabled={!canDelete} className="text-red-11">
          <Trash2 />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const row = (active: boolean) =>
  cn("group/node flex h-9 w-full items-center gap-2 rounded-control pr-1 text-left text-ui transition-colors", active ? "bg-iris-3 font-medium text-slate-12" : "text-slate-12 hover:bg-slate-3");

/** Campaign → ad sets → ads, as in Ads Manager's editing panel. */
export function EditorTree(p: Props) {
  const { doc, selected } = p;
  return (
    <nav aria-label="Campaign structure" className="grid content-start gap-0.5">
      <button type="button" onClick={() => p.onSelect({ level: "campaign" })} className={cn(row(selected.level === "campaign"), "pl-2")} aria-current={selected.level === "campaign" ? "true" : undefined}>
        <Megaphone className="size-4 shrink-0 text-slate-11" aria-hidden />
        <span className="min-w-0 flex-1 truncate">{doc.campaign.name || "New campaign"}</span>
        <Dot node="campaign" issues={p.issues} />
      </button>
      {doc.adsets.map((s) => (
        <div key={s.key} className="grid gap-0.5">
          <div className={cn(row(selected.level === "adset" && selected.s === s.key), "pl-6")}>
            <button
              type="button"
              onClick={() => p.onSelect({ level: "adset", s: s.key })}
              className="flex h-full min-w-0 flex-1 items-center gap-2 rounded-control text-left outline-offset-[-2px]"
              aria-current={selected.level === "adset" && selected.s === s.key ? "true" : undefined}
            >
              <LayoutGrid className="size-4 shrink-0 text-slate-11" aria-hidden />
              <span className="min-w-0 flex-1 truncate">{s.name || "New ad set"}</span>
              <Dot node={s.key} issues={p.issues} />
            </button>
            <NodeMenu label={s.name} onDuplicate={() => p.onDuplicateAdset(s.key)} onDelete={() => p.onDeleteAdset(s.key)} canDelete={doc.adsets.length > 1} />
          </div>
          {s.ads.map((a) => {
            const active = selected.level === "ad" && selected.a === a.key;
            return (
              <div key={a.key} className={cn(row(active), "pl-10")}>
                <button
                  type="button"
                  onClick={() => p.onSelect({ level: "ad", s: s.key, a: a.key })}
                  className="flex h-full min-w-0 flex-1 items-center gap-2 rounded-control text-left outline-offset-[-2px]"
                  aria-current={active ? "true" : undefined}
                >
                  <ImageIcon className="size-4 shrink-0 text-slate-11" aria-hidden />
                  <span className="min-w-0 flex-1 truncate">{a.name || "New ad"}</span>
                  <Dot node={a.key} issues={p.issues} />
                </button>
                <NodeMenu label={a.name} onDuplicate={() => p.onDuplicateAd(s.key, a.key)} onDelete={() => p.onDeleteAd(s.key, a.key)} canDelete={s.ads.length > 1} />
              </div>
            );
          })}
          <button type="button" onClick={() => p.onAddAd(s.key)} className="flex h-8 items-center gap-2 rounded-control pl-10 text-ui text-iris-11 hover:bg-iris-3">
            <Plus className="size-4" />
            Create ad
          </button>
        </div>
      ))}
      <button type="button" onClick={p.onAddAdset} className="flex h-8 items-center gap-2 rounded-control pl-6 text-ui text-iris-11 hover:bg-iris-3">
        <Plus className="size-4" />
        Create ad set
      </button>
    </nav>
  );
}

"use client";

import { Heart, MessageCircle, Send } from "lucide-react";
import type { CreativeItem } from "@/lib/server/creatives";
import { label } from "@fahd/shared/meta-options";
import type { CopyBlock } from "@fahd/shared/launch-plan";
import { cn } from "@/lib/utils";

export type Placement = "feed" | "stories" | "reels";

/** Picks the file Meta would serve in a placement: 9:16 for Stories/Reels, 4:5 (or 1:1) for Feed. */
export function fileFor(files: CreativeItem[], placement: Placement) {
  const want = placement === "feed" ? ["4:5", "1:1", "9:16", "16:9"] : ["9:16", "4:5", "1:1", "16:9"];
  return [...files].sort((a, b) => want.indexOf(a.ratio ?? "") - want.indexOf(b.ratio ?? ""))[0];
}

/** An approximate phone frame: enough to check crop, copy length and CTA, not a pixel-exact Meta preview. */
export function PhonePreview({ placement, files, copy, pageName }: { placement: Placement; files: CreativeItem[]; copy: CopyBlock; pageName: string }) {
  const file = fileFor(files, placement);
  const text = copy.primaryTexts[0] ?? "";
  const headline = copy.headlines[0] ?? "";
  const cropped = file && placement !== "feed" && file.ratio !== "9:16";
  return (
    <figure className="grid gap-1.5">
      <div className="relative mx-auto aspect-[9/19] w-[200px] overflow-hidden rounded-[28px] border-[6px] border-slate-12 bg-slate-12 dark:border-slate-6">
        {placement === "feed" ? (
          <div className="flex h-full flex-col bg-white text-[10px] leading-snug text-black">
            <div className="flex items-center gap-1.5 px-2 pt-5 pb-1.5">
              <span className="size-5 rounded-full bg-slate-5" />
              <span className="font-semibold">{pageName}</span>
              <span className="text-[9px] text-neutral-500">Sponsored</span>
            </div>
            <p className="line-clamp-3 px-2 pb-1.5 whitespace-pre-line">{text || "Primary text"}</p>
            <div className="aspect-[4/5] w-full bg-neutral-200">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {file && <img src={file.previewUrl} alt="" className="size-full object-cover" />}
            </div>
            <div className="flex items-center gap-2 bg-neutral-100 px-2 py-1.5">
              <span className="min-w-0 flex-1 truncate font-semibold">{headline || "Headline"}</span>
              <span className="shrink-0 rounded-[4px] bg-neutral-300 px-1.5 py-0.5 font-semibold">{label(copy.cta)}</span>
            </div>
            <div className="flex gap-3 px-2 py-1.5 text-neutral-500">
              <Heart className="size-3" /> <MessageCircle className="size-3" /> <Send className="size-3" />
            </div>
          </div>
        ) : (
          <div className="relative h-full">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {file && <img src={file.previewUrl} alt="" className={cn("size-full", file.ratio === "9:16" ? "object-cover" : "object-contain")} />}
            <div className="absolute inset-x-0 top-0 flex items-center gap-1.5 px-2 pt-4 text-[10px] font-semibold text-white drop-shadow">
              <span className="size-5 rounded-full bg-white/40" />
              {pageName}
              <span className="font-normal opacity-80">Sponsored</span>
            </div>
            <div className="absolute inset-x-0 bottom-0 grid gap-1.5 bg-gradient-to-t from-black/70 to-transparent px-2 pt-8 pb-4 text-[10px] text-white">
              {placement === "reels" && <p className="line-clamp-2">{text}</p>}
              <span className="justify-self-center rounded-full bg-white px-3 py-1 font-semibold text-black">{label(copy.cta)}</span>
            </div>
          </div>
        )}
      </div>
      <figcaption className="text-center text-label text-slate-11">
        {placement === "feed" ? "Feed" : placement === "stories" ? "Stories" : "Reels"}
        {file?.ratio ? ` · ${file.ratio}` : ""}
        {cropped && <span className="text-amber-11"> · cropped</span>}
      </figcaption>
    </figure>
  );
}

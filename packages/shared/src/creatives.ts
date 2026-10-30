/** Creative rules shared by the browser (before upload) and the server. */

export const RATIOS = ["9:16", "4:5", "1:1", "16:9"] as const;
export type Ratio = (typeof RATIOS)[number];

const RATIO_VALUES: Record<Ratio, number> = { "9:16": 9 / 16, "4:5": 4 / 5, "1:1": 1, "16:9": 16 / 9 };

/** The supported ratio within 2%, or null. */
export function ratioOf(width: number, height: number): Ratio | null {
  if (!width || !height) return null;
  const r = width / height;
  for (const ratio of RATIOS) if (Math.abs(r - RATIO_VALUES[ratio]) / RATIO_VALUES[ratio] <= 0.02) return ratio;
  return null;
}

const RATIO_SUFFIX = /[ _.-]+(9x16|4x5|1x1|16x9|916|45|11|169|story|stories|reels?|feed|square|vertical|portrait|landscape)$/i;

/** Filename stem without extension or ratio suffix: hook3_9x16.mp4 → hook3. */
export function groupKey(fileName: string) {
  const stem = fileName.replace(/\.[a-z0-9]{2,5}$/i, "");
  return stem.replace(RATIO_SUFFIX, "").trim().toLowerCase() || stem.toLowerCase();
}

export type CreativeFile = { fileName: string; kind: "image" | "video"; width: number; height: number; durationS?: number | null; sizeBytes: number };

export type Issue = { level: "error" | "warning"; message: string };

const MB = 1024 * 1024;

/** Upload checks (docs/spec.md → Launch builder step 2): ratio, resolution, length, size. */
export function validateCreative(f: CreativeFile): Issue[] {
  const issues: Issue[] = [];
  const ratio = ratioOf(f.width, f.height);
  if (!ratio) issues.push({ level: "warning", message: `${f.width}×${f.height} is not 9:16, 4:5, 1:1 or 16:9; Meta will crop it.` });
  const short = Math.min(f.width, f.height);
  if (short < 600) issues.push({ level: "error", message: `Too small: ${f.width}×${f.height}. Use at least 1080 px on the short side.` });
  else if (short < 1080) issues.push({ level: "warning", message: `Low resolution: ${f.width}×${f.height}. 1080 px on the short side looks sharper.` });
  if (f.kind === "video") {
    const d = f.durationS ?? 0;
    if (d > 241 * 60) issues.push({ level: "error", message: "Videos can be at most 241 minutes." });
    else if (d > 90) issues.push({ level: "warning", message: `${Math.round(d)} s is longer than Reels allow (90 s); it will only run in feeds.` });
    if (d > 0 && d < 1) issues.push({ level: "error", message: "Videos must be at least 1 second long." });
    if (f.sizeBytes > 4 * 1024 * MB) issues.push({ level: "error", message: "Videos can be at most 4 GB." });
  } else if (f.sizeBytes > 30 * MB) {
    issues.push({ level: "error", message: "Images can be at most 30 MB." });
  }
  return issues;
}

export type CreativeGroup<T extends { groupKey: string; ratio: Ratio | null }> = {
  key: string;
  items: T[];
  ratios: Ratio[];
  /** Vertical (9:16) for Stories/Reels plus 4:5 or 1:1 for Feed. */
  paired: boolean;
};

/** Groups files by stem so 9:16 and 4:5 versions become one creative. */
export function pairCreatives<T extends { groupKey: string; ratio: Ratio | null }>(items: T[]): CreativeGroup<T>[] {
  const groups = new Map<string, T[]>();
  for (const item of items) groups.set(item.groupKey, [...(groups.get(item.groupKey) ?? []), item]);
  return [...groups].map(([key, list]) => {
    const ratios = [...new Set(list.map((i) => i.ratio).filter((r): r is Ratio => r !== null))];
    return { key, items: list, ratios, paired: ratios.includes("9:16") && (ratios.includes("4:5") || ratios.includes("1:1")) };
  });
}

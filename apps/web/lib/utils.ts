import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

const merge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: ["label", "ui", "body", "section", "title", "kpi"] }],
      shadow: [{ shadow: ["float"] }],
      rounded: [{ rounded: ["xs", "control", "card", "dialog"] }],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return merge(clsx(inputs));
}


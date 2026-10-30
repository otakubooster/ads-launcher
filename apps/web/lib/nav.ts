import {
  Images,
  LayoutDashboard,
  Rocket,
  ScrollText,
  Settings,
  SlidersHorizontal,
  Table2,
  Type,
  type LucideIcon,
} from "lucide-react";

import { LAUNCH_FEATURES, isLaunchPath } from "./features";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Second key of the `G` then `<key>` jump shortcut. */
  goKey?: string;
};

const ALL_NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, goKey: "d" },
  { href: "/ads", label: "Ads", icon: Table2, goKey: "a" },
  { href: "/launch", label: "Launch", icon: Rocket, goKey: "l" },
  { href: "/creatives", label: "Creatives", icon: Images },
  { href: "/copy", label: "Copy", icon: Type },
  { href: "/launches", label: "Launch log", icon: ScrollText },
  { href: "/presets", label: "Presets", icon: SlidersHorizontal },
  { href: "/settings", label: "Settings", icon: Settings },
];

export const NAV_ITEMS = LAUNCH_FEATURES ? ALL_NAV_ITEMS : ALL_NAV_ITEMS.filter((i) => !isLaunchPath(i.href));

export function isNavActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export type Shortcut = { keys: string[]; label: string; separator?: "then" | "+" };

/** Shown in the shortcuts dialog; `mod` renders as ⌘ on Mac and Ctrl elsewhere. */
export const SHORTCUTS: { group: string; items: Shortcut[] }[] = [
  {
    group: "General",
    items: [
      { keys: ["mod", "K"], label: "Open command palette", separator: "+" },
      { keys: ["/"], label: "Focus filter" },
      { keys: ["?"], label: "Show keyboard shortcuts" },
      { keys: ["Esc"], label: "Close drawer or dialog" },
      { keys: ["mod", "Enter"], label: "Confirm dialog", separator: "+" },
    ],
  },
  {
    group: "Go to",
    items: NAV_ITEMS.filter((i) => i.goKey).map((i) => ({
      keys: ["G", i.goKey!.toUpperCase()],
      label: i.label,
      separator: "then" as const,
    })),
  },
  {
    group: "Tables",
    items: [
      { keys: ["J"], label: "Next row" },
      { keys: ["K"], label: "Previous row" },
      { keys: ["X"], label: "Select row" },
      { keys: ["Shift", "Click"], label: "Select range", separator: "+" },
    ],
  },
];

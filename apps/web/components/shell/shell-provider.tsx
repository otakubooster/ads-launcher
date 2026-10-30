"use client";

import * as React from "react";
import type { DatePresetId } from "@/lib/date-range";
import type { ScopeAccount } from "@/lib/scope";
import { SIDEBAR_COOKIE } from "@/lib/sidebar";


export type Role = "owner" | "admin" | "buyer" | "viewer";

type ShellState = {
  sidebarCollapsed: boolean;
  setSidebarCollapsed: (collapsed: boolean) => void;
  commandOpen: boolean;
  setCommandOpen: React.Dispatch<React.SetStateAction<boolean>>;
  shortcutsOpen: boolean;
  setShortcutsOpen: (open: boolean) => void;
  mobileNavOpen: boolean;
  setMobileNavOpen: (open: boolean) => void;

  // Scope and dates move to URL search params once pages read data (session 5).
  accounts: ScopeAccount[];
  selectedAccountIds: string[];
  setSelectedAccountIds: (ids: string[]) => void;
  datePreset: DatePresetId;
  setDatePreset: (preset: DatePresetId) => void;
  compare: boolean;
  setCompare: (compare: boolean) => void;
  lastSyncedAt: Date | null;
  usagePct: number | null;
  user: ShellUser;
};

export type ShellUser = { name: string; email: string; role: Role };

const ShellContext = React.createContext<ShellState | null>(null);

export function useShell() {
  const ctx = React.useContext(ShellContext);
  if (!ctx) throw new Error("useShell must be used inside <ShellProvider>");
  return ctx;
}

export type ShellProviderProps = {
  defaultCollapsed: boolean;
  user: ShellUser;
  accounts: ScopeAccount[];
  lastSyncedAt: string | null;
  usagePct: number | null;
  children: React.ReactNode;
};

export function ShellProvider({ defaultCollapsed, user, accounts, lastSyncedAt, usagePct, children }: ShellProviderProps) {
  const [sidebarCollapsed, setCollapsed] = React.useState(defaultCollapsed);
  const [commandOpen, setCommandOpen] = React.useState(false);
  const [shortcutsOpen, setShortcutsOpen] = React.useState(false);
  const [mobileNavOpen, setMobileNavOpen] = React.useState(false);
  const [selectedAccountIds, setSelectedAccountIds] = React.useState<string[]>([]);
  const [datePreset, setDatePreset] = React.useState<DatePresetId>("last_7d");
  const [compare, setCompare] = React.useState(true);

  const setSidebarCollapsed = React.useCallback((collapsed: boolean) => {
    setCollapsed(collapsed);
    document.cookie = `${SIDEBAR_COOKIE}=${collapsed ? 1 : 0}; path=/; max-age=31536000; samesite=lax`;
  }, []);

  const value = React.useMemo<ShellState>(
    () => ({
      sidebarCollapsed,
      setSidebarCollapsed,
      commandOpen,
      setCommandOpen,
      shortcutsOpen,
      setShortcutsOpen,
      mobileNavOpen,
      setMobileNavOpen,
      accounts,
      selectedAccountIds,
      setSelectedAccountIds,
      datePreset,
      setDatePreset,
      compare,
      setCompare,
      lastSyncedAt: lastSyncedAt ? new Date(lastSyncedAt) : null,
      usagePct,
      user,
    }),
    [sidebarCollapsed, setSidebarCollapsed, commandOpen, shortcutsOpen, mobileNavOpen, selectedAccountIds, datePreset, compare, accounts, lastSyncedAt, usagePct, user],
  );

  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>;
}

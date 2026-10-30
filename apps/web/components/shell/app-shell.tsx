"use client";

import * as React from "react";
import Link from "next/link";
import { OctagonX } from "lucide-react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { CommandPalette } from "./command-palette";
import { ShortcutsDialog, useGlobalShortcuts } from "./keyboard-shortcuts";
import { ShellProvider, useShell, type ShellProviderProps } from "./shell-provider";
import { Sidebar } from "./sidebar";
import { TopBar } from "./top-bar";

export function AppShell({ children, ...props }: ShellProviderProps) {
  return (
    <ShellProvider {...props}>
      <TooltipProvider delayDuration={400}>
        <ShellLayout>{children}</ShellLayout>
      </TooltipProvider>
    </ShellProvider>
  );
}

function ShellLayout({ children }: { children: React.ReactNode }) {
  useGlobalShortcuts();
  return (
    <div className="flex h-dvh overflow-hidden">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <main id="main" className="flex-1 overflow-y-auto px-4 py-6 md:px-6">
          <KillSwitchBanner />
          <StaleBanner />
          {children}
        </main>
      </div>
      <CommandPalette />
      <ShortcutsDialog />
    </div>
  );
}

/** Every page says so while the kill switch is on (docs/spec.md → Spend guardrails). */
function KillSwitchBanner() {
  const { killSwitchOn, user } = useShell();
  if (!killSwitchOn) return null;
  return (
    <p role="alert" className="mb-4 flex items-center gap-2 rounded-control border border-red-7 bg-red-3 px-3 py-2 text-ui font-medium text-red-11">
      <OctagonX className="size-4 shrink-0" />
      <span className="flex-1">Kill switch is on: queues and launches are stopped, and nothing new goes to Meta.</span>
      {user.role === "owner" && (
        <Link href="/settings#kill-switch" className="underline underline-offset-2">
          Turn off in Settings
        </Link>
      )}
    </p>
  );
}

const STALE_AFTER_MS = 30 * 60_000;

/** A quiet banner when the last sync is over 30 minutes old (docs/spec.md → States). */
function StaleBanner() {
  const { lastSyncedAt } = useShell();
  const [minutes, setMinutes] = React.useState<number | null>(null);
  React.useEffect(() => {
    const check = () => {
      const age = lastSyncedAt ? Date.now() - lastSyncedAt.getTime() : 0;
      setMinutes(age > STALE_AFTER_MS ? Math.round(age / 60_000) : null);
    };
    const id = setInterval(check, 60_000);
    const first = setTimeout(check, 0);
    return () => (clearInterval(id), clearTimeout(first));
  }, [lastSyncedAt]);
  if (minutes === null) return null;
  return (
    <p role="status" className="mb-4 rounded-control border border-amber-6 bg-amber-2 px-3 py-2 text-ui text-amber-11">
      Data was last synced {minutes} minutes ago. Numbers may be behind Ads Manager.
    </p>
  );
}

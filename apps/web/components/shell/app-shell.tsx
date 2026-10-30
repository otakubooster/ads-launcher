"use client";

import * as React from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { CommandPalette } from "./command-palette";
import { ShortcutsDialog, useGlobalShortcuts } from "./keyboard-shortcuts";
import { ShellProvider, type ShellProviderProps } from "./shell-provider";
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
          {children}
        </main>
      </div>
      <CommandPalette />
      <ShortcutsDialog />
    </div>
  );
}

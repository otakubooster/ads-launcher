"use client";

import { Menu, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useModKey } from "@/lib/hooks/use-media-query";
import { DateRangePicker } from "./date-range-picker";
import { ScopeSwitcher } from "./scope-switcher";
import { useShell } from "./shell-provider";
import { SidebarContent } from "./sidebar";
import { SyncStatus } from "./sync-status";

export function TopBar() {
  const { setCommandOpen, mobileNavOpen, setMobileNavOpen } = useShell();
  const mod = useModKey();

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b border-slate-6 bg-slate-1 px-4 md:px-6">
      <Button variant="ghost" size="icon" className="-ml-1 md:hidden" aria-label="Open menu" onClick={() => setMobileNavOpen(true)}>
        <Menu />
      </Button>
      <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <SheetContent side="left" data-sidebar="expanded" className="bg-slate-2 dark:bg-slate-2">
          <SheetTitle className="sr-only">Menu</SheetTitle>
          <SidebarContent inSheet onNavigate={() => setMobileNavOpen(false)} />
        </SheetContent>
      </Sheet>

      <div className="-ml-2 min-w-0">
        <ScopeSwitcher />
      </div>

      <div className="ml-auto flex items-center gap-2">
        <DateRangePicker />
        <AttributionChip />
        <SyncStatus />
        <Button
          className="hidden gap-2 pr-1.5 text-slate-11 lg:inline-flex"
          onClick={() => setCommandOpen(true)}
          aria-label="Open command palette"
        >
          <Search />
          <span className="w-24 text-left">Search…</span>
          <Kbd>{mod === "⌘" ? "⌘K" : "Ctrl K"}</Kbd>
        </Button>
        <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open command palette" onClick={() => setCommandOpen(true)}>
          <Search />
        </Button>
      </div>
    </header>
  );
}

function AttributionChip() {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          className="hidden h-6 items-center rounded-full border border-slate-6 px-2 text-label font-medium whitespace-nowrap text-slate-11 xl:inline-flex"
        >
          7-day click · 1-day view
        </span>
      </TooltipTrigger>
      <TooltipContent>Attribution window for purchases, CPA and ROAS</TooltipContent>
    </Tooltip>
  );
}

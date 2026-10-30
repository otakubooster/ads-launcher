"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Gauge, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { NAV_ITEMS, isNavActive } from "@/lib/nav";
import { useMediaQuery } from "@/lib/hooks/use-media-query";
import { cn } from "@/lib/utils";
import { Progress } from "@/components/ui/progress";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useShell } from "./shell-provider";
import { UserMenu } from "./user-menu";

/** Desktop sidebar: 240px, or a 64px icon rail below 1280px or when collapsed. */
export function Sidebar() {
  const { sidebarCollapsed } = useShell();
  return (
    <aside
      data-sidebar={sidebarCollapsed ? "collapsed" : "responsive"}
      className="hidden w-60 shrink-0 flex-col border-r border-slate-6 bg-slate-2 transition-[width] duration-200 ease-out md:flex rail:w-16"
    >
      <SidebarContent />
    </aside>
  );
}

/** Shared by the desktop sidebar and the mobile sheet (data-sidebar="expanded"). */
export function SidebarContent({ inSheet = false, onNavigate }: { inSheet?: boolean; onNavigate?: () => void }) {
  const pathname = usePathname();
  const { sidebarCollapsed, setSidebarCollapsed } = useShell();
  const wide = useMediaQuery("(min-width: 1280px)", true);
  const isRail = !inSheet && (sidebarCollapsed || !wide);

  return (
    <>
      <div className="flex h-14 shrink-0 items-center gap-2.5 px-4 rail:justify-center rail:px-0">
        <div
          aria-hidden
          className="flex size-6 shrink-0 items-center justify-center rounded-control bg-iris-9 text-label font-semibold text-white"
        >
          F
        </div>
        <span className="truncate text-body font-semibold rail:hidden">Fahd Ads Launcher</span>
      </div>

      <nav aria-label="Main" className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-3 py-2 rail:px-3">
        {NAV_ITEMS.map((item) => {
          const active = isNavActive(pathname, item.href);
          const Icon = item.icon;
          const link = (
            <Link
              href={item.href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              aria-label={item.label}
              className={cn(
                "flex h-8 items-center gap-2.5 rounded-control px-2.5 text-ui font-medium text-slate-11 transition-colors hover:bg-slate-3 hover:text-slate-12",
                "aria-[current=page]:bg-slate-4 aria-[current=page]:text-slate-12",
                "rail:justify-center rail:px-0",
              )}
            >
              <Icon className="size-4 shrink-0" />
              <span className="truncate rail:hidden">{item.label}</span>
            </Link>
          );
          return isRail ? (
            <Tooltip key={item.href} delayDuration={0}>
              <TooltipTrigger asChild>{link}</TooltipTrigger>
              <TooltipContent side="right">{item.label}</TooltipContent>
            </Tooltip>
          ) : (
            <div key={item.href}>{link}</div>
          );
        })}
      </nav>

      <div className="flex flex-col gap-1 border-t border-slate-6 p-3">
        <ApiUsageMeter isRail={isRail} />
        <button
          type="button"
          onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
          aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="hidden h-8 items-center gap-2.5 rounded-control px-2.5 text-ui font-medium text-slate-11 hover:bg-slate-3 hover:text-slate-12 xl:flex rail:justify-center rail:px-0 [[data-sidebar=expanded]_&]:hidden"
        >
          {sidebarCollapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
          <span className="rail:hidden">Collapse</span>
        </button>
        <UserMenu isRail={isRail} />
      </div>
    </>
  );
}

/** Fed by api_usage rows from Meta's rate-limit headers once accounts sync. */
function ApiUsageMeter({ isRail }: { isRail: boolean }) {
  const { usagePct, accounts } = useShell();
  const caption =
    usagePct === null
      ? accounts.length
        ? "No calls in the last hour"
        : "No accounts connected"
      : usagePct >= 75
        ? "Paused: Meta usage is high"
        : "Highest account, last hour";

  if (isRail) {
    return (
      <Tooltip delayDuration={0}>
        <TooltipTrigger asChild>
          <div
            tabIndex={0}
            aria-label={`API usage: ${caption}`}
            className="hidden h-8 items-center justify-center rounded-control text-slate-11 rail:flex"
          >
            <Gauge className="size-4" />
          </div>
        </TooltipTrigger>
        <TooltipContent side="right">API usage · {caption}</TooltipContent>
      </Tooltip>
    );
  }

  return (
    <div className="flex flex-col gap-1.5 px-2.5 py-2 rail:hidden">
      <div className="flex items-center justify-between text-label">
        <span className="font-medium text-slate-11">API usage</span>
        <span className="text-slate-11 tabular-nums">{usagePct === null ? "—" : `${Math.round(usagePct)}%`}</span>
      </div>
      <Progress
        value={usagePct ?? 0}
        aria-label="API usage"
        indicatorClassName={usagePct !== null && usagePct >= 75 ? "bg-red-9" : usagePct !== null && usagePct >= 50 ? "bg-amber-9" : undefined}
      />
      <span className="text-label text-slate-11">{caption}</span>
    </div>
  );
}

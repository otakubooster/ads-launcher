"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { refreshAction } from "@/app/(app)/ads/actions";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatRelativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useShell } from "./shell-provider";

const STALE_AFTER_MS = 30 * 60 * 1000;
/** Opening the app refreshes data older than this (minutes; 0 turns it off, as in e2e). */
const AUTO_SYNC_MINUTES = Number(process.env.NEXT_PUBLIC_AUTO_SYNC_MINUTES ?? 10);

export function SyncStatus() {
  const { lastSyncedAt, selectedAccountIds, accounts } = useShell();
  const [now, setNow] = useState(() => new Date());
  const [pending, start] = useTransition();
  const router = useRouter();

  function refresh() {
    if (accounts.length === 0) {
      toast("Nothing to sync yet", { description: "Connect a Business Manager in Settings first." });
      return;
    }
    start(async () => {
      const res = await refreshAction(selectedAccountIds);
      if (res.ok) toast.success(res.message ?? "Synced");
      else toast.error(res.error.title, { description: res.error.detail });
      router.refresh();
    });
  }

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  // Once per visit: quietly refresh when the last sync is old (hosts without the worker).
  const autoSynced = useRef(false);
  useEffect(() => {
    if (autoSynced.current || !AUTO_SYNC_MINUTES || accounts.length === 0) return;
    if (lastSyncedAt && Date.now() - lastSyncedAt.getTime() < AUTO_SYNC_MINUTES * 60_000) return;
    autoSynced.current = true;
    start(async () => {
      const res = await refreshAction([]);
      if (res.ok) router.refresh();
    });
  }, [accounts.length, lastSyncedAt, router]);

  const stale = lastSyncedAt !== null && now.getTime() - lastSyncedAt.getTime() > STALE_AFTER_MS;
  const text = lastSyncedAt ? `Synced ${formatRelativeTime(lastSyncedAt, now)}` : "Not synced yet";

  return (
    <div className="flex items-center gap-1">
      <span className="hidden items-center gap-1.5 text-ui text-slate-11 lg:flex">
        <span
          aria-hidden
          className={cn("size-1.5 rounded-full", !lastSyncedAt ? "bg-slate-8" : stale ? "bg-amber-9" : "bg-grass-9")}
        />
        {text}
      </span>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Refresh data"
            disabled={pending}
            onClick={refresh}
          >
            <RefreshCw className={cn(pending && "animate-spin")} />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{text} · Refresh</TooltipContent>
      </Tooltip>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatRelativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useShell } from "./shell-provider";

const STALE_AFTER_MS = 30 * 60 * 1000;

export function SyncStatus() {
  const { lastSyncedAt } = useShell();
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

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
            onClick={() =>
              toast("Nothing to sync yet", { description: "Connect a Business Manager in Settings first." })
            }
          >
            <RefreshCw />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{text} · Refresh</TooltipContent>
      </Tooltip>
    </div>
  );
}

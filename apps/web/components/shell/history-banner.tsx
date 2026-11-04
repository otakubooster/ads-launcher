"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { History } from "lucide-react";
import { toast } from "sonner";
import { loadHistoryAction } from "@/app/(app)/ads/actions";
import { Button } from "@/components/ui/button";
import { formatRange } from "@/lib/date-range";
import type { HistoryGap } from "@/lib/server/history";

/** Shown when the date range starts before the days stored so far: fetches them from Meta. */
export function HistoryBanner({ gap, until, accountIds }: { gap: HistoryGap; until: string; accountIds: string[] }) {
  const router = useRouter();
  const [busy, start] = React.useTransition();
  return (
    <div role="status" className="flex flex-wrap items-center gap-3 rounded-card border border-blue-6 bg-blue-2 px-4 py-2.5 text-ui">
      <History className="size-4 shrink-0 text-blue-11" aria-hidden />
      <p className="min-w-0 flex-1">
        Some days in {formatRange({ since: gap.since, until }, new Date().toISOString().slice(0, 10))} aren&apos;t loaded yet for {gap.accounts} {gap.accounts === 1 ? "ad account" : "ad accounts"}, so totals may be low.
      </p>
      <Button
        size="sm"
        variant="primary"
        disabled={busy}
        onClick={() =>
          start(async () => {
            const res = await loadHistoryAction(gap.since, accountIds);
            if (res.ok) toast.success(res.message ?? "History loaded");
            else toast.error(res.error.title, { description: res.error.detail });
            router.refresh();
          })
        }
      >
        {busy ? "Loading from Meta…" : "Load history"}
      </Button>
    </div>
  );
}

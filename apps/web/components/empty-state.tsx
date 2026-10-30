import * as React from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** One sentence and one primary action (docs/spec.md → States every screen handles). */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex min-h-80 flex-col items-center justify-center rounded-card border border-slate-6 px-6 py-12 text-center",
        className,
      )}
    >
      <div className="mb-4 flex size-10 items-center justify-center rounded-card border border-slate-6 bg-slate-2 text-slate-11">
        <Icon className="size-5" />
      </div>
      <h2 className="text-section font-semibold">{title}</h2>
      <p className="mt-1 max-w-sm text-body text-slate-11">{description}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

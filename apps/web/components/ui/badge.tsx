import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva("inline-flex h-5 items-center gap-1 rounded-xs px-1.5 text-label font-medium whitespace-nowrap", {
  variants: {
    tone: {
      neutral: "bg-slate-3 text-slate-11",
      positive: "bg-grass-3 text-grass-11",
      negative: "bg-red-3 text-red-11",
      warning: "bg-amber-3 text-amber-11",
      info: "bg-blue-3 text-blue-11",
      accent: "bg-iris-3 text-iris-11",
    },
  },
  defaultVariants: { tone: "neutral" },
});

export function Badge({ className, tone, ...props }: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}

const DOT = {
  positive: "bg-grass-9",
  info: "bg-blue-9",
  warning: "bg-amber-9",
  negative: "bg-red-9",
  neutral: "bg-slate-8",
} as const;

/** 8px dot + label (docs/spec.md → Data table spec). */
export function StatusDot({ tone, label, className }: { tone: keyof typeof DOT; label: string; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2 whitespace-nowrap", className)}>
      <span aria-hidden className={cn("size-2 shrink-0 rounded-full", DOT[tone])} />
      {label}
    </span>
  );
}

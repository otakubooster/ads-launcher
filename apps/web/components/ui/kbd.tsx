import * as React from "react";
import { cn } from "@/lib/utils";

export function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded-xs border border-slate-6 bg-slate-2 px-1 font-sans text-label font-medium text-slate-11",
        className,
      )}
      {...props}
    />
  );
}

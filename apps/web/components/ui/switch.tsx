"use client";

import * as React from "react";
import { Switch as SwitchPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";

export function Switch({ className, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        "peer inline-flex h-5 w-8 shrink-0 items-center rounded-full border border-transparent transition-colors disabled:opacity-50 data-[state=checked]:bg-iris-9 data-[state=unchecked]:bg-slate-6",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="pointer-events-none block size-4 translate-x-0.5 rounded-full bg-white shadow-sm transition-transform data-[state=checked]:translate-x-3.5" />
    </SwitchPrimitive.Root>
  );
}

/**
 * The same switch as a plain button: cheap enough to render in every table row.
 * Use Switch elsewhere.
 */
export function RowSwitch({
  checked,
  onCheckedChange,
  className,
  ...props
}: Omit<React.ComponentProps<"button">, "onChange"> & { checked: boolean; onCheckedChange: (checked: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      data-state={checked ? "checked" : "unchecked"}
      onClick={(e) => {
        e.stopPropagation();
        onCheckedChange(!checked);
      }}
      className={cn(
        "inline-flex h-5 w-8 shrink-0 items-center rounded-full transition-colors disabled:opacity-50",
        checked ? "bg-iris-9" : "bg-slate-6",
        className,
      )}
      {...props}
    >
      <span className={cn("block size-4 rounded-full bg-white shadow-sm transition-transform", checked ? "translate-x-3.5" : "translate-x-0.5")} />
    </button>
  );
}

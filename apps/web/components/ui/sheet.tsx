"use client";

import * as React from "react";
import { Dialog as SheetPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";
import { DialogOverlay } from "./dialog";

export const Sheet = SheetPrimitive.Root;
export const SheetTrigger = SheetPrimitive.Trigger;
export const SheetClose = SheetPrimitive.Close;
export const SheetTitle = SheetPrimitive.Title;

export function SheetContent({
  className,
  side = "right",
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Content> & { side?: "left" | "right" }) {
  return (
    <SheetPrimitive.Portal>
      <DialogOverlay />
      <SheetPrimitive.Content
        className={cn(
          "fixed inset-y-0 z-50 flex flex-col bg-slate-1 shadow-float outline-none duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out dark:bg-slate-2",
          side === "right"
            ? "right-0 w-[480px] max-w-full border-l border-slate-6 rounded-l-dialog data-[state=open]:slide-in-from-right data-[state=closed]:slide-out-to-right"
            : "left-0 w-72 max-w-[85vw] border-r border-slate-6 rounded-r-dialog data-[state=open]:slide-in-from-left data-[state=closed]:slide-out-to-left",
          className,
        )}
        {...props}
      />
    </SheetPrimitive.Portal>
  );
}

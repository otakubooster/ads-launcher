import * as React from "react";
import { cn } from "@/lib/utils";

export const inputClass =
  "h-8 w-full min-w-0 rounded-control border border-slate-7 bg-slate-1 px-2.5 text-ui text-slate-12 transition-colors outline-none placeholder:text-slate-10 hover:border-slate-8 focus-visible:border-iris-8 focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-iris-8 disabled:opacity-50 aria-invalid:border-red-8 dark:bg-slate-2";

export function Input({ className, ...props }: React.ComponentProps<"input">) {
  return <input className={cn(inputClass, className)} {...props} />;
}

export function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return <textarea className={cn(inputClass, "h-auto min-h-20 py-2 leading-5", className)} {...props} />;
}

export function NativeSelect({ className, ...props }: React.ComponentProps<"select">) {
  return <select className={cn(inputClass, "cursor-default pr-7", className)} {...props} />;
}

export function Label({ className, ...props }: React.ComponentProps<"label">) {
  return <label className={cn("text-label font-medium text-slate-11", className)} {...props} />;
}

export function Field({ label, hint, htmlFor, children, className }: { label: string; hint?: string; htmlFor?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("grid gap-1.5", className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint && <p className="text-label text-slate-11">{hint}</p>}
    </div>
  );
}

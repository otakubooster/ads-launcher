import * as React from "react";
import { cn } from "@/lib/utils";

/** Native checkbox on the design tokens; supports indeterminate. */
export function Checkbox({ className, indeterminate, ...props }: React.ComponentProps<"input"> & { indeterminate?: boolean }) {
  const ref = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => {
    if (ref.current) ref.current.indeterminate = Boolean(indeterminate);
  }, [indeterminate]);
  return (
    <input
      ref={ref}
      type="checkbox"
      className={cn("size-4 shrink-0 cursor-default rounded-xs border-slate-8 accent-iris-9", className)}
      {...props}
    />
  );
}

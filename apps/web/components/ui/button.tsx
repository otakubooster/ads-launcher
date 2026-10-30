import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import { cn } from "@/lib/utils";

export const buttonVariants = cva(
  "inline-flex shrink-0 cursor-default items-center justify-center gap-1.5 whitespace-nowrap rounded-control font-medium transition-colors select-none disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "bg-iris-9 text-white hover:bg-iris-10",
        secondary:
          "border border-slate-7 bg-slate-1 text-slate-12 hover:border-slate-8 hover:bg-slate-3 active:bg-slate-4 dark:bg-slate-2",
        ghost: "text-slate-11 hover:bg-slate-3 hover:text-slate-12 active:bg-slate-4 data-[state=open]:bg-slate-4",
        destructive: "bg-red-9 text-white hover:bg-red-10",
      },
      size: {
        sm: "h-7 px-2 text-ui",
        md: "h-8 px-3 text-ui",
        lg: "h-9 px-4 text-body",
        "icon-sm": "size-7",
        icon: "size-8",
      },
    },
    defaultVariants: { variant: "secondary", size: "md" },
  },
);

type ButtonProps = React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean };

export function Button({ className, variant, size, asChild = false, type, ...props }: ButtonProps) {
  const Comp = asChild ? Slot.Root : "button";
  return (
    <Comp
      data-slot="button"
      type={asChild ? undefined : (type ?? "button")}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}

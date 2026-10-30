/** Shared surface for every floating layer: the only place shadows appear. */
export const floatingSurface =
  "rounded-card border border-slate-6 bg-slate-1 text-slate-12 shadow-float dark:bg-slate-2";

export const floatingMotion =
  "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-1 data-[side=top]:slide-in-from-bottom-1 data-[side=left]:slide-in-from-right-1 data-[side=right]:slide-in-from-left-1";

export const menuItem =
  "relative flex h-8 cursor-default items-center gap-2 rounded-xs px-2 text-ui text-slate-12 outline-none select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[highlighted]:bg-slate-4 [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-slate-11";

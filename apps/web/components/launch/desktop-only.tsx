import { Monitor } from "lucide-react";

/** Below 768 px the app is read-only; launching stays on desktop (docs/spec.md → Responsive). */
export function DesktopOnly({ children }: { children: React.ReactNode }) {
  return (
    <>
      <p className="flex items-center gap-2 rounded-card border border-slate-6 px-4 py-3 text-body text-slate-11 md:hidden">
        <Monitor className="size-4 shrink-0" />
        Launching works on a larger screen. Open this page on a desktop to continue.
      </p>
      <div className="hidden md:contents">{children}</div>
    </>
  );
}

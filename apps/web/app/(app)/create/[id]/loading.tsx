import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading" className="grid gap-4">
      <div className="flex h-14 items-center gap-3 border-b border-slate-6">
        <Skeleton className="size-8" />
        <div className="grid flex-1 gap-1.5">
          <Skeleton className="h-4 w-64" />
          <Skeleton className="h-3 w-80" />
        </div>
        <Skeleton className="h-8 w-24" />
      </div>
      <div className="grid grid-cols-[280px_minmax(0,1fr)] gap-6">
        <div className="grid content-start gap-1 rounded-card border border-slate-6 p-2">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
        <div className="grid content-start gap-4">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-40 w-full rounded-card" />
          <Skeleton className="h-56 w-full rounded-card" />
        </div>
      </div>
    </div>
  );
}

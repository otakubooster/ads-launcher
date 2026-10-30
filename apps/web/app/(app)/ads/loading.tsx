import { Skeleton } from "@/components/ui/skeleton";

export default function AdsLoading() {
  return (
    <div aria-busy="true" aria-label="Loading ads" className="grid gap-3">
      <div className="flex gap-2">
        <Skeleton className="h-9 w-24" />
        <Skeleton className="h-9 w-20" />
        <Skeleton className="h-9 w-16" />
      </div>
      <div className="flex gap-2">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-8 w-48" />
        <Skeleton className="ml-auto h-8 w-40" />
      </div>
      <div className="overflow-hidden rounded-card border border-slate-6">
        <Skeleton className="h-9 rounded-none" />
        {Array.from({ length: 12 }, (_, i) => (
          <div key={i} className="flex h-10 items-center gap-4 border-t border-slate-6 px-3">
            <Skeleton className="h-4 w-14" />
            <Skeleton className="h-4 w-56" />
            <Skeleton className="ml-auto h-4 w-20" />
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-4 w-16" />
          </div>
        ))}
      </div>
    </div>
  );
}

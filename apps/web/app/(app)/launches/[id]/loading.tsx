import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading">
      <div className="mb-6 grid gap-2">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-5 w-72" />
      </div>
      <div className="overflow-hidden rounded-card border border-slate-6">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="flex h-10 items-center gap-4 border-b border-slate-6 px-3 last:border-0">
            <Skeleton className="h-4 flex-1" />
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-5 w-20" />
          </div>
        ))}
      </div>
    </div>
  );
}

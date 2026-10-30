import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading">
      <div className="mb-6 grid gap-2">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-5 w-72" />
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="grid gap-3 rounded-card border border-slate-6 p-4">
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-8 w-24" />
            <Skeleton className="h-6 w-full" />
          </div>
        ))}
      </div>
      <Skeleton className="mt-3 h-80 w-full rounded-card" />
    </div>
  );
}

import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading">
      <div className="mb-6 grid gap-2">
        <Skeleton className="h-7 w-64" />
        <Skeleton className="h-5 w-80" />
      </div>
      <div className="grid grid-cols-[176px_minmax(0,1fr)_256px] gap-6">
        <div className="grid content-start gap-1">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
        <div className="grid content-start gap-4">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-32 w-full rounded-card" />
          <Skeleton className="h-20 w-full rounded-card" />
        </div>
        <Skeleton className="h-64 w-full rounded-card" />
      </div>
    </div>
  );
}

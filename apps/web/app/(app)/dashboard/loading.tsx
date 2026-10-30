import { Skeleton } from "@/components/ui/skeleton";

export default function DashboardLoading() {
  return (
    <div aria-busy="true" aria-label="Loading dashboard">
      <div className="mb-6 grid gap-2">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-5 w-72" />
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="grid gap-2 rounded-card border border-slate-6 p-4">
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-8 w-28" />
            <Skeleton className="h-7 w-full" />
          </div>
        ))}
      </div>
      <div className="mt-3 grid gap-3 xl:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]">
        <Skeleton className="h-96 rounded-card" />
        <Skeleton className="h-96 rounded-card" />
      </div>
      <Skeleton className="mt-3 h-72 rounded-card" />
    </div>
  );
}

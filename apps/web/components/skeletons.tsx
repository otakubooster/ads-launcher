import { Skeleton } from "@/components/ui/skeleton";

/** Page title and description placeholders, matching PageHeader. */
export function HeaderSkeleton() {
  return (
    <div className="mb-6 grid gap-2">
      <Skeleton className="h-7 w-40" />
      <Skeleton className="h-5 w-72" />
    </div>
  );
}

export function TableSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="overflow-hidden rounded-card border border-slate-6">
      <div className="h-9 border-b border-slate-6 bg-slate-2" />
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex h-10 items-center gap-4 border-b border-slate-6 px-3 last:border-0">
          <Skeleton className="h-4 flex-1" />
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-5 w-20" />
        </div>
      ))}
    </div>
  );
}

export function CardGridSkeleton({ cards = 8, aspect = "aspect-[4/5]" }: { cards?: number; aspect?: string }) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
      {Array.from({ length: cards }, (_, i) => (
        <div key={i} className="overflow-hidden rounded-card border border-slate-6">
          <Skeleton className={`${aspect} w-full rounded-none`} />
          <div className="grid gap-2 p-3">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function SectionsSkeleton({ sections = 3 }: { sections?: number }) {
  return (
    <div className="grid max-w-4xl gap-6">
      {Array.from({ length: sections }, (_, i) => (
        <div key={i} className="rounded-card border border-slate-6">
          <div className="grid gap-2 border-b border-slate-6 px-5 py-4">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-4 w-80 max-w-full" />
          </div>
          <div className="grid gap-3 px-5 py-4">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
          </div>
        </div>
      ))}
    </div>
  );
}

import { CardGridSkeleton, HeaderSkeleton } from "@/components/skeletons";

export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading">
      <HeaderSkeleton />
      <CardGridSkeleton cards={6} aspect="aspect-[3/1]" />
    </div>
  );
}

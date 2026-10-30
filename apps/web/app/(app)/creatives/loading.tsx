import { CardGridSkeleton, HeaderSkeleton } from "@/components/skeletons";

export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading">
      <HeaderSkeleton />
      <CardGridSkeleton />
    </div>
  );
}

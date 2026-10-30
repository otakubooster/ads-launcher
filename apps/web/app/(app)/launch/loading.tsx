import { HeaderSkeleton, SectionsSkeleton } from "@/components/skeletons";

export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading">
      <HeaderSkeleton />
      <SectionsSkeleton sections={2} />
    </div>
  );
}

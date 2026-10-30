import type { Metadata } from "next";
import { Images } from "lucide-react";
import { NotYetButton } from "@/components/not-yet-button";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";

export const metadata: Metadata = { title: "Creatives" };

export default function CreativesPage() {
  return (
    <>
      <PageHeader title="Creatives" description="Images and videos with performance across every ad that uses them." />
      <EmptyState
        icon={Images}
        title="No creatives yet"
        description="Upload images and videos once; 9:16 and 4:5 versions pair automatically by file name."
        action={<NotYetButton variant="primary" message="Uploads arrive with the creatives library.">Upload creatives</NotYetButton>}
      />
    </>
  );
}

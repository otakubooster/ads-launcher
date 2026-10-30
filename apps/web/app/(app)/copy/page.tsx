import type { Metadata } from "next";
import { Type } from "lucide-react";
import { NotYetButton } from "@/components/not-yet-button";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";

export const metadata: Metadata = { title: "Copy" };

export default function CopyPage() {
  return (
    <>
      <PageHeader title="Copy" description="Reusable primary texts, headlines and CTAs per brand and language." />
      <EmptyState
        icon={Type}
        title="No copy sets yet"
        description="Save up to five primary texts and headlines once, then reuse them in any launch."
        action={<NotYetButton variant="primary" message="Copy sets arrive with the launch builder.">New copy set</NotYetButton>}
      />
    </>
  );
}

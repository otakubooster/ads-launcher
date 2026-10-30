import type { Metadata } from "next";
import { SlidersHorizontal } from "lucide-react";
import { NotYetButton } from "@/components/not-yet-button";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";

export const metadata: Metadata = { title: "Presets" };

export default function PresetsPage() {
  return (
    <>
      <PageHeader title="Presets" description="Where each brand and market's ads go." />
      <EmptyState
        icon={SlidersHorizontal}
        title="No presets yet"
        description="A preset bundles the ad account, page, Instagram account, pixel and UTMs for one brand and market."
        action={<NotYetButton variant="primary" message="Presets need a connected Business Manager first.">Create preset</NotYetButton>}
      />
    </>
  );
}

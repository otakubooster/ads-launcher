import type { Metadata } from "next";
import { Rocket } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";

export const metadata: Metadata = { title: "Launch" };

export default function LaunchPage() {
  return (
    <>
      <PageHeader title="Launch" description="Bulk-launch ads from creatives and copy. Everything is created paused." />
      <EmptyState
        icon={Rocket}
        title="Start with a preset"
        description="A preset fills the ad account, page, Instagram account, pixel and UTMs, so a launch takes minutes."
        action={<Button variant="primary" asChild><Link href="/presets">Create your first preset</Link></Button>}
      />
    </>
  );
}

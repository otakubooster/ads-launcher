import type { Metadata } from "next";
import { Table2 } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";

export const metadata: Metadata = { title: "Ads" };

export default function AdsPage() {
  return (
    <>
      <PageHeader title="Ads" description="Campaigns, ad sets and ads with live metrics." />
      <EmptyState
        icon={Table2}
        title="No campaigns synced"
        description="Campaigns, ad sets and ads appear here after the first sync with Meta."
        action={<Button variant="primary" asChild><Link href="/settings">Connect Meta</Link></Button>}
      />
    </>
  );
}

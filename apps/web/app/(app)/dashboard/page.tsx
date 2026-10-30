import type { Metadata } from "next";
import { BarChart3 } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";

export const metadata: Metadata = { title: "Dashboard" };

export default function DashboardPage() {
  return (
    <>
      <PageHeader title="Dashboard" description="Spend, purchases and ROAS across every brand and market." />
      <EmptyState
        icon={BarChart3}
        title="No data yet"
        description="Connect a Business Manager to see spend, purchases and ROAS across every ad account."
        action={<Button variant="primary" asChild><Link href="/settings">Connect Meta</Link></Button>}
      />
    </>
  );
}

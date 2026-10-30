import type { Metadata } from "next";
import { ScrollText } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";

export const metadata: Metadata = { title: "Launch log" };

export default function LaunchLogPage() {
  return (
    <>
      <PageHeader title="Launch log" description="Every launch, who started it and what was created." />
      <EmptyState
        icon={ScrollText}
        title="No launches yet"
        description="Each launch shows its live progress, Meta IDs and any errors here."
        action={<Button variant="primary" asChild><Link href="/launch">New launch</Link></Button>}
      />
    </>
  );
}

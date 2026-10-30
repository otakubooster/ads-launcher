import type { Metadata } from "next";
import { ScrollText } from "lucide-react";
import Link from "next/link";
import { EmptyState } from "@/components/empty-state";
import { LaunchList } from "@/components/launch/launch-log";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { requireSession } from "@/lib/server/auth";
import { loadLaunchList } from "@/lib/server/launches";

export const metadata: Metadata = { title: "Launch log" };

export default async function LaunchLogPage() {
  const session = await requireSession();
  const rows = await loadLaunchList(session.userId);
  const action =
    session.role !== "viewer" ? (
      <Button variant="primary" asChild className="hidden md:inline-flex">
        <Link href="/launch">New launch</Link>
      </Button>
    ) : undefined;
  return (
    <>
      <PageHeader title="Launch log" description="Every launch, who started it and what was created." actions={rows.length ? action : undefined} />
      {rows.length === 0 ? (
        <EmptyState icon={ScrollText} title="No launches yet" description="Each launch shows its live progress, Meta IDs and any errors here." action={action} />
      ) : (
        <LaunchList rows={rows} />
      )}
    </>
  );
}

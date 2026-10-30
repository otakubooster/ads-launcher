import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { LaunchBuilder } from "@/components/launch/builder";
import { DesktopOnly } from "@/components/launch/desktop-only";
import { PageHeader } from "@/components/page-header";
import { requireSession } from "@/lib/server/auth";
import { loadCreatives } from "@/lib/server/creatives";
import { loadBuilder } from "@/lib/server/launch";

export const metadata: Metadata = { title: "Launch" };

export default async function LaunchDraftPage({ params }: { params: Promise<{ draftId: string }> }) {
  const session = await requireSession();
  const { draftId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(draftId)) notFound();
  if (session.role === "viewer") redirect(`/launches/${draftId}`);
  const data = await loadBuilder(session.userId, draftId);
  if (!data) notFound();
  if ("status" in data) redirect(`/launches/${draftId}`);
  const today = data.preset.today;
  const library = await loadCreatives(session.userId, { since: today, until: today });

  return (
    <>
      <PageHeader title={data.launch.name} description={`${data.preset.brandName} · ${data.preset.market} · everything is created paused`} />
      {/* A preset switch rewrites the draft on the server: remount with it. */}
      <DesktopOnly>
        <LaunchBuilder key={data.launch.presetId} data={data} library={library.items} role={session.role} />
      </DesktopOnly>
    </>
  );
}

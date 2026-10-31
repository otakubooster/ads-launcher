import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { CampaignEditor } from "@/components/editor/campaign-editor";
import { DesktopOnly } from "@/components/launch/desktop-only";
import { requireSession } from "@/lib/server/auth";
import { loadCreatives } from "@/lib/server/creatives";
import { loadEditor } from "@/lib/server/editor";

export const metadata: Metadata = { title: "Create campaign" };

export default async function CreateCampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  if (session.role === "viewer") redirect(`/launches/${id}`);
  const data = await loadEditor(session.userId, id);
  if (!data) notFound();
  if ("status" in data) redirect(`/launches/${id}`);
  const today = data.defaults.date;
  const library = await loadCreatives(session.userId, { since: today, until: today });

  return (
    <DesktopOnly>
      <CampaignEditor data={data} library={library.items} />
    </DesktopOnly>
  );
}

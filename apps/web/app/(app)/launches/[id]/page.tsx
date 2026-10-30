import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { LaunchLogView } from "@/components/launch/launch-log";
import { requireSession } from "@/lib/server/auth";
import { loadLaunchLog } from "@/lib/server/launches";

export const metadata: Metadata = { title: "Launch log" };

export default async function LaunchLogDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const log = await loadLaunchLog(session.userId, id);
  if (!log) notFound();
  if (log.status === "draft" && session.role !== "viewer") redirect(`/launch/${id}`);
  return <LaunchLogView log={log} role={session.role} />;
}

import type { Metadata } from "next";
import { Rocket } from "lucide-react";
import Link from "next/link";
import { brands, launches, presets, users } from "@fahd/db/schema";
import { asc, desc, eq, sql } from "drizzle-orm";
import { EmptyState } from "@/components/empty-state";
import { DesktopOnly } from "@/components/launch/desktop-only";
import { NewLaunch } from "@/components/launch/new-launch";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { TimeAgo } from "@/components/ui/time-ago";
import { requireSession } from "@/lib/server/auth";
import { asUser } from "@/lib/server/db";

export const metadata: Metadata = { title: "Launch" };

export default async function LaunchPage({ searchParams }: { searchParams: Promise<{ creatives?: string }> }) {
  const session = await requireSession();
  const creativeIds = ((await searchParams).creatives ?? "").split(",").filter((id) => /^[0-9a-f-]{36}$/i.test(id));
  const data = await asUser(session.userId, async (tx) => ({
    presets: await tx
      .select({ id: presets.id, brand: brands.name, market: presets.market, language: presets.language })
      .from(presets)
      .innerJoin(brands, eq(brands.id, presets.brandId))
      .orderBy(asc(brands.name), asc(presets.market)),
    drafts: await tx
      .select({ id: launches.id, name: launches.name, updatedAt: launches.updatedAt, by: sql<string>`coalesce(${users.name}, ${users.email})`, editor: sql<boolean>`${launches.structure} ? 'editor'`, brand: brands.name, market: presets.market })
      .from(launches)
      .innerJoin(presets, eq(presets.id, launches.presetId))
      .innerJoin(brands, eq(brands.id, presets.brandId))
      .innerJoin(users, eq(users.id, launches.createdBy))
      .where(eq(launches.status, "draft"))
      .orderBy(desc(launches.updatedAt))
      .limit(50),
  }));
  const canLaunch = session.role !== "viewer";

  if (data.presets.length === 0) {
    return (
      <>
        <PageHeader title="Launch" description="Create a campaign the Ads Manager way, or bulk-launch from creatives and copy. Everything is created paused." />
        <EmptyState
          icon={Rocket}
          title="Start with a preset"
          description="A preset fills the ad account, page, Instagram account, pixel and UTMs, so a launch takes minutes."
          action={
            <Button variant="primary" asChild>
              <Link href="/presets">Create your first preset</Link>
            </Button>
          }
        />
      </>
    );
  }

  return (
    <>
      <PageHeader title="Launch" description="Create a campaign the Ads Manager way, or bulk-launch from creatives and copy. Everything is created paused." />
      <div className="grid max-w-3xl gap-8">
        {canLaunch && (
          <DesktopOnly>
            <NewLaunch presets={data.presets.map((p) => ({ id: p.id, label: `${p.brand} · ${p.market} · ${p.language}` }))} creativeIds={creativeIds} />
          </DesktopOnly>
        )}
        <section aria-labelledby="drafts-title" className="grid gap-3">
          <h2 id="drafts-title" className="text-section font-semibold">
            Drafts
          </h2>
          {data.drafts.length === 0 ? (
            <p className="rounded-card border border-slate-6 px-4 py-6 text-body text-slate-11">No drafts. A launch saves itself as a draft until you create it.</p>
          ) : (
            <ul className="overflow-hidden rounded-card border border-slate-6">
              {data.drafts.map((d) => (
                <li key={d.id} className="border-b border-slate-6 last:border-0">
                  <Link href={d.editor ? `/create/${d.id}` : `/launch/${d.id}`} className="flex h-10 items-center gap-3 px-3 text-ui hover:bg-slate-2">
                    <span className="min-w-0 flex-1 truncate font-medium">{d.name}</span>
                    <span className="text-label text-slate-11">{d.editor ? "Campaign" : "Bulk launch"}</span>
                    <span className="text-slate-11">
                      {d.brand} · {d.market}
                    </span>
                    <span className="w-40 text-right text-slate-11">
                      {d.by} · <TimeAgo iso={d.updatedAt.toISOString()} />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}

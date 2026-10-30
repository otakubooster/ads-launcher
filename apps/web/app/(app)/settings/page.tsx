import type { Metadata } from "next";
import { Building2, Gauge, Plug, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { NotYetButton } from "@/components/not-yet-button";
import { PageHeader } from "@/components/page-header";

export const metadata: Metadata = { title: "Settings" };

const SECTIONS: {
  id: string;
  title: string;
  description: string;
  icon: LucideIcon;
  empty: string;
  action?: { label: string; message: string };
}[] = [
  {
    id: "meta",
    title: "Meta connections",
    description: "One system user token per Business Manager. Tokens are encrypted and never reach the browser.",
    icon: Plug,
    empty: "No Business Manager connected. Paste a system user token to connect one.",
    action: { label: "Add connection", message: "Meta connections arrive in the next build session." },
  },
  {
    id: "accounts",
    title: "Ad accounts",
    description: "Launch access, max daily budget and approval threshold per account.",
    icon: Building2,
    empty: "Ad accounts appear here once a Business Manager is connected.",
  },
  {
    id: "team",
    title: "Team",
    description: "Owners, admins, media buyers and viewers.",
    icon: Users,
    empty: "Invite teammates by email once sign-in is set up.",
    action: { label: "Invite", message: "Team invites arrive with authentication." },
  },
  {
    id: "usage",
    title: "API usage",
    description: "Per-account usage from Meta's rate-limit headers. Queues pause at 75%.",
    icon: Gauge,
    empty: "Usage bars appear once accounts start syncing.",
  },
];

export default function SettingsPage() {
  return (
    <>
      <PageHeader title="Settings" description="Meta connections, guardrails, team and API usage." />
      <div className="grid gap-8 lg:grid-cols-[180px_minmax(0,1fr)]">
        <nav aria-label="Settings sections" className="hidden lg:block">
          <ul className="sticky top-0 grid gap-0.5">
            {SECTIONS.map((s) => (
              <li key={s.id}>
                <a
                  href={`#${s.id}`}
                  className="flex h-8 items-center rounded-control px-2.5 text-ui font-medium text-slate-11 hover:bg-slate-3 hover:text-slate-12"
                >
                  {s.title}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <div className="grid max-w-3xl gap-6">
          {SECTIONS.map((s) => (
            <section key={s.id} id={s.id} aria-labelledby={`${s.id}-title`} className="scroll-mt-6 rounded-card border border-slate-6">
              <header className="flex items-start justify-between gap-4 border-b border-slate-6 px-5 py-4">
                <div>
                  <h2 id={`${s.id}-title`} className="text-section font-semibold">
                    {s.title}
                  </h2>
                  <p className="mt-0.5 text-body text-slate-11">{s.description}</p>
                </div>
                {s.action && (
                  <NotYetButton message={s.action.message} className="shrink-0">
                    {s.action.label}
                  </NotYetButton>
                )}
              </header>
              <div className="flex items-center gap-3 px-5 py-6 text-body text-slate-11">
                <s.icon className="size-5 shrink-0" />
                {s.empty}
              </div>
            </section>
          ))}
        </div>
      </div>
    </>
  );
}

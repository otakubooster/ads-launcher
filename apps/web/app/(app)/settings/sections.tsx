"use client";

import { useActionState, useState, useTransition } from "react";
import { Building2, Check, Gauge, Plug, RefreshCw, ShieldCheck, UserPlus, Users, X } from "lucide-react";
import { toast } from "sonner";
import { Badge, StatusDot } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, Input, NativeSelect, Textarea } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { formatMoney, formatRelativeTime, moneyInputValue } from "@/lib/format";
import { accountStatus } from "@/lib/meta-labels";
import type { ActionResult } from "@/lib/server/action-result";
import { cn } from "@/lib/utils";
import {
  addConnection,
  changeRole,
  inviteMember,
  replaceToken,
  reverifyConnection,
  syncConnection,
  updateGuardrails,
} from "./actions";

const SECTIONS = [
  { id: "meta", title: "Meta connections" },
  { id: "accounts", title: "Ad accounts" },
  { id: "team", title: "Team" },
  { id: "usage", title: "API usage" },
];

export function SettingsNav() {
  return (
    <nav aria-label="Settings sections" className="hidden lg:block">
      <ul className="sticky top-0 grid gap-0.5">
        {SECTIONS.map((s) => (
          <li key={s.id}>
            <a href={`#${s.id}`} className="flex h-8 items-center rounded-control px-2.5 text-ui font-medium text-slate-11 hover:bg-slate-3 hover:text-slate-12">
              {s.title}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function Section({ id, title, description, action, children }: { id: string; title: string; description: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="min-w-0 scroll-mt-6 rounded-card border border-slate-6">
      <header className="flex items-start justify-between gap-4 border-b border-slate-6 px-5 py-4">
        <div>
          <h2 id={`${id}-title`} className="text-section font-semibold">
            {title}
          </h2>
          <p className="mt-0.5 text-body text-slate-11">{description}</p>
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

function SectionEmpty({ icon: Icon, children }: { icon: typeof Plug; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 px-5 py-6 text-body text-slate-11">
      <Icon className="size-5 shrink-0" />
      <span>{children}</span>
    </div>
  );
}

function notify(result: ActionResult) {
  if (result.ok) toast.success(result.message ?? "Saved");
  else toast.error(result.error.title, { description: [result.error.detail, result.error.fix].filter(Boolean).join(" ") });
}

function ErrorText({ result }: { result: ActionResult | null }) {
  if (!result || result.ok) return null;
  return (
    <div role="alert" className="rounded-control border border-red-6 bg-red-2 px-3 py-2 text-ui text-red-11">
      <p className="font-medium">{result.error.title}</p>
      <p>{result.error.detail}</p>
      {result.error.fix && <p className="mt-1 text-red-11">{result.error.fix}</p>}
    </div>
  );
}

/** A form in a dialog that closes and toasts on success. */
function useDialogForm(action: (prev: ActionResult | null, fd: FormData) => Promise<ActionResult>) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(async (prev: ActionResult | null, fd: FormData) => {
    const result = await action(prev, fd);
    if (result.ok) {
      notify(result);
      setOpen(false);
    }
    return result;
  }, null);
  return { open, setOpen, state: open ? state : null, formAction, pending };
}

// --- Meta connections -------------------------------------------------------

type Connection = {
  id: string;
  businessId: string;
  businessName: string;
  tokenLast4: string;
  scopes: string[];
  status: "unverified" | "active" | "broken";
  lastVerifiedAt: string | null;
  adAccounts: number;
  assets: Partial<Record<"page" | "instagram" | "pixel", number>>;
};

const CONNECTION_STATUS = {
  active: { tone: "positive", label: "Connected" },
  unverified: { tone: "warning", label: "Permissions missing" },
  broken: { tone: "negative", label: "Token not working" },
} as const;

export function ConnectionsSection({ connections, required, canManage, canSync }: { connections: Connection[]; required: string[]; canManage: boolean; canSync: boolean }) {
  const add = useDialogForm(addConnection);
  return (
    <Section
      id="meta"
      title="Meta connections"
      description="One system user token per Business Manager. Tokens are encrypted and never reach the browser."
      action={
        canManage && (
          <Button className="shrink-0" onClick={() => add.setOpen(true)}>
            <Plug />
            Add connection
          </Button>
        )
      }
    >
      {connections.length === 0 ? (
        <SectionEmpty icon={Plug}>
          {canManage ? "No Business Manager connected. Add a connection with a system user token." : "No Business Manager connected yet. Ask an owner to connect one."}
        </SectionEmpty>
      ) : (
        <ul className="divide-y divide-slate-6">
          {connections.map((c) => (
            <ConnectionRow key={c.id} connection={c} required={required} canManage={canManage} canSync={canSync} />
          ))}
        </ul>
      )}

      <Dialog open={add.open} onOpenChange={add.setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Connect a Business Manager</DialogTitle>
            <DialogDescription>Create the system user and token as in the Meta setup checklist, then paste it here.</DialogDescription>
          </DialogHeader>
          <form action={add.formAction} className="grid gap-4 px-5 py-4">
            <Field label="Business ID" htmlFor="businessId" hint="Business Settings → Business info.">
              <Input id="businessId" name="businessId" inputMode="numeric" required autoComplete="off" />
            </Field>
            <Field label="System user token" htmlFor="token" hint="Stored encrypted. Only the last 4 characters are shown again.">
              <Textarea id="token" name="token" required autoComplete="off" spellCheck={false} className="font-mono text-label" />
            </Field>
            <ErrorText result={add.state} />
            <div className="flex justify-end gap-2">
              <Button onClick={() => add.setOpen(false)}>Cancel</Button>
              <Button type="submit" variant="primary" disabled={add.pending}>
                {add.pending ? "Verifying and syncing…" : "Connect"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </Section>
  );
}

function ConnectionRow({ connection: c, required, canManage, canSync }: { connection: Connection; required: string[]; canManage: boolean; canSync: boolean }) {
  const [pending, start] = useTransition();
  const replace = useDialogForm(replaceToken);
  const status = CONNECTION_STATUS[c.status];
  const run = (fn: () => Promise<ActionResult>) => start(async () => notify(await fn()));

  return (
    <li className="grid gap-4 px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-body font-semibold">{c.businessName}</h3>
            <Badge tone={status.tone}>{status.label}</Badge>
          </div>
          <p className="mt-0.5 text-ui text-slate-11">
            <span className="font-mono">{c.businessId}</span> · token ••••{c.tokenLast4} · verified{" "}
            {c.lastVerifiedAt ? formatRelativeTime(new Date(c.lastVerifiedAt)) : "never"}
          </p>
          <p className="mt-0.5 text-ui text-slate-11 tabular-nums">
            {c.adAccounts} ad accounts · {c.assets.page ?? 0} pages · {c.assets.instagram ?? 0} Instagram · {c.assets.pixel ?? 0} pixels
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canSync && (
            <Button disabled={pending} onClick={() => run(() => syncConnection(c.id))}>
              <RefreshCw className={cn(pending && "animate-spin")} />
              Sync now
            </Button>
          )}
          {canManage && (
            <>
              <Button disabled={pending} onClick={() => run(() => reverifyConnection(c.id))}>
                <ShieldCheck />
                Re-verify
              </Button>
              <Button disabled={pending} onClick={() => replace.setOpen(true)}>
                Replace token
              </Button>
            </>
          )}
        </div>
      </div>
      <ul aria-label="Required permissions" className="flex flex-wrap gap-1.5">
        {required.map((p) => {
          const ok = c.scopes.includes(p);
          return (
            <li key={p}>
              <Badge tone={ok ? "positive" : "negative"} className="font-mono">
                {ok ? <Check className="size-3" /> : <X className="size-3" />}
                {p}
              </Badge>
            </li>
          );
        })}
      </ul>

      <Dialog open={replace.open} onOpenChange={replace.setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Replace token</DialogTitle>
            <DialogDescription>The new token is verified before the old one is overwritten.</DialogDescription>
          </DialogHeader>
          <form action={replace.formAction} className="grid gap-4 px-5 py-4">
            <input type="hidden" name="connectionId" value={c.id} />
            <Field label="New system user token" htmlFor={`token-${c.id}`}>
              <Textarea id={`token-${c.id}`} name="token" required autoComplete="off" spellCheck={false} className="font-mono text-label" />
            </Field>
            <ErrorText result={replace.state} />
            <div className="flex justify-end gap-2">
              <Button onClick={() => replace.setOpen(false)}>Cancel</Button>
              <Button type="submit" variant="primary" disabled={replace.pending}>
                {replace.pending ? "Verifying…" : "Replace token"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </li>
  );
}

// --- Ad accounts ------------------------------------------------------------

type Account = {
  id: string;
  metaId: string;
  name: string;
  currency: string;
  timezone: string;
  accountStatus: number;
  maxDailyBudget: number | null;
  approvalThreshold: number | null;
  launchEnabled: boolean;
};

export function AccountsSection({ accounts, canEdit }: { accounts: Account[]; canEdit: boolean }) {
  return (
    <Section id="accounts" title="Ad accounts" description="Launch access, max daily budget and approval threshold per account.">
      {accounts.length === 0 ? (
        <SectionEmpty icon={Building2}>Ad accounts appear here once a Business Manager is connected.</SectionEmpty>
      ) : (
        <ul className="divide-y divide-slate-6">
          {accounts.map((a) => (
            <AccountRow key={a.id} account={a} canEdit={canEdit} />
          ))}
        </ul>
      )}
    </Section>
  );
}

function AccountRow({ account: a, canEdit }: { account: Account; canEdit: boolean }) {
  const [, action, pending] = useActionState(async (prev: ActionResult | null, fd: FormData) => {
    const result = await updateGuardrails(prev, fd);
    notify(result);
    return result;
  }, null);
  const [launch, setLaunch] = useState(a.launchEnabled);
  const status = accountStatus(a.accountStatus);

  return (
    <li className="px-5 py-4">
      <form action={action} className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
        <input type="hidden" name="accountId" value={a.id} />
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <h3 className="truncate text-body font-semibold">{a.name}</h3>
            <StatusDot tone={status.tone} label={status.label} className="text-ui text-slate-11" />
          </div>
          <p className="mt-0.5 text-ui text-slate-11">
            <span className="font-mono">{a.metaId}</span> · {a.currency} · {a.timezone}
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex h-8 items-center gap-2 text-ui">
            <Switch checked={launch} onCheckedChange={setLaunch} disabled={!canEdit} aria-label={`Launches enabled for ${a.name}`} />
            <input type="hidden" name="launchEnabled" value={launch ? "on" : ""} />
            Launches
          </label>
          <Field label={`Max daily budget (${a.currency})`} htmlFor={`max-${a.id}`} className="w-40">
            <Input id={`max-${a.id}`} name="maxDailyBudget" inputMode="decimal" placeholder="No limit" defaultValue={moneyInputValue(a.maxDailyBudget, a.currency)} disabled={!canEdit} className="text-right tabular-nums" />
          </Field>
          <Field label={`Approval above (${a.currency})`} htmlFor={`approval-${a.id}`} className="w-40">
            <Input id={`approval-${a.id}`} name="approvalThreshold" inputMode="decimal" placeholder="No approval" defaultValue={moneyInputValue(a.approvalThreshold, a.currency)} disabled={!canEdit} className="text-right tabular-nums" />
          </Field>
          {canEdit && (
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </Button>
          )}
        </div>
      </form>
      {!canEdit && (a.maxDailyBudget !== null || a.approvalThreshold !== null) && (
        <p className="mt-2 text-ui text-slate-11 tabular-nums">
          Limit {formatMoney(a.maxDailyBudget, a.currency, { compact: false })}/day · approval above {formatMoney(a.approvalThreshold, a.currency, { compact: false })}
        </p>
      )}
    </li>
  );
}

// --- Team -------------------------------------------------------------------

type Member = { id: string; name: string | null; email: string; role: "owner" | "admin" | "buyer" | "viewer" };
const ROLES = [
  { value: "owner", label: "Owner" },
  { value: "admin", label: "Admin" },
  { value: "buyer", label: "Media buyer" },
  { value: "viewer", label: "Viewer" },
] as const;

export function TeamSection({ members, canManage, canCreateOwners, currentUserId }: { members: Member[]; canManage: boolean; canCreateOwners: boolean; currentUserId: string }) {
  const invite = useDialogForm(inviteMember);
  const [pending, start] = useTransition();
  const roles = ROLES.filter((r) => canCreateOwners || r.value !== "owner");

  return (
    <Section
      id="team"
      title="Team"
      description="Owners, admins, media buyers and viewers."
      action={
        canManage && (
          <Button className="shrink-0" onClick={() => invite.setOpen(true)}>
            <UserPlus />
            Invite
          </Button>
        )
      }
    >
      {members.length === 0 ? (
        <SectionEmpty icon={Users}>No members yet.</SectionEmpty>
      ) : (
        <ul className="divide-y divide-slate-6">
          {members.map((m) => {
            const locked = !canManage || m.id === currentUserId || (m.role === "owner" && !canCreateOwners);
            return (
              <li key={m.id} className="flex items-center justify-between gap-4 px-5 py-3">
                <div className="min-w-0">
                  <p className="truncate text-body font-medium">
                    {m.name ?? m.email}
                    {m.id === currentUserId && <span className="ml-2 text-ui font-normal text-slate-11">You</span>}
                  </p>
                  <p className="truncate text-ui text-slate-11">{m.email}</p>
                </div>
                {locked ? (
                  <span className="text-ui text-slate-11">{ROLES.find((r) => r.value === m.role)?.label}</span>
                ) : (
                  <NativeSelect
                    aria-label={`Role for ${m.email}`}
                    defaultValue={m.role}
                    disabled={pending}
                    className="w-36"
                    onChange={(e) => start(async () => notify(await changeRole(m.id, e.target.value)))}
                  >
                    {roles.map((r) => (
                      <option key={r.value} value={r.value}>
                        {r.label}
                      </option>
                    ))}
                  </NativeSelect>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <Dialog open={invite.open} onOpenChange={invite.setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invite a teammate</DialogTitle>
            <DialogDescription>They get an email to set a password. Owners and admins also set up two-factor sign-in.</DialogDescription>
          </DialogHeader>
          <form action={invite.formAction} className="grid gap-4 px-5 py-4">
            <Field label="Email" htmlFor="invite-email">
              <Input id="invite-email" name="email" type="email" required />
            </Field>
            <Field label="Name" htmlFor="invite-name">
              <Input id="invite-name" name="name" />
            </Field>
            <Field label="Role" htmlFor="invite-role">
              <NativeSelect id="invite-role" name="role" defaultValue="buyer">
                {roles.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <ErrorText result={invite.state} />
            <div className="flex justify-end gap-2">
              <Button onClick={() => invite.setOpen(false)}>Cancel</Button>
              <Button type="submit" variant="primary" disabled={invite.pending}>
                {invite.pending ? "Inviting…" : "Send invite"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </Section>
  );
}

// --- API usage --------------------------------------------------------------

type UsageRow = { id: string; name: string; pct: number | null; at: string | null; tier: string | null };

export function UsageSection({ rows }: { rows: UsageRow[] }) {
  return (
    <Section id="usage" title="API usage" description="Latest usage from Meta's rate-limit headers. Each account's queue pauses at 75%.">
      {rows.length === 0 ? (
        <SectionEmpty icon={Gauge}>Usage bars appear once accounts start syncing.</SectionEmpty>
      ) : (
        <ul className="grid gap-4 px-5 py-4">
          {rows.map((r) => (
            <li key={r.id} className="grid gap-1.5">
              <div className="flex items-baseline justify-between gap-3 text-ui">
                <span className="truncate font-medium">{r.name}</span>
                <span className="shrink-0 text-slate-11 tabular-nums">
                  {r.pct === null ? "No readings" : `${r.pct.toFixed(1)}%`}
                  {r.at && ` · ${formatRelativeTime(new Date(r.at))}`}
                  {r.tier && ` · ${r.tier.replace(/_/g, " ")}`}
                </span>
              </div>
              <Progress
                value={r.pct ?? 0}
                aria-label={`API usage for ${r.name}`}
                indicatorClassName={r.pct !== null && r.pct >= 75 ? "bg-red-9" : r.pct !== null && r.pct >= 50 ? "bg-amber-9" : "bg-iris-9"}
              />
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

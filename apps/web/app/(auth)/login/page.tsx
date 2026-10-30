import type { Metadata } from "next";
import { users } from "@fahd/db/schema";
import { asc } from "drizzle-orm";
import { Button } from "@/components/ui/button";
import { authMode } from "@/lib/server/auth";
import { getDb } from "@/lib/server/db";
import { devSignIn } from "../actions";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

const ROLE_ORDER = { owner: 0, admin: 1, buyer: 2, viewer: 3 } as const;

export default async function LoginPage() {
  const mode = authMode();

  if (mode === "dev") {
    const members = (await getDb().select().from(users).orderBy(asc(users.email))).sort(
      (a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role],
    );
    return (
      <>
        <h1 className="text-title font-semibold">Development sign-in</h1>
        <p className="mt-1 text-body text-slate-11">Pick a seeded member. Disabled in production.</p>
        {members.length === 0 ? (
          <p className="mt-5 text-body text-slate-11">
            No members yet. Run <code className="font-mono text-label">pnpm db:seed --minimal</code> first.
          </p>
        ) : (
          <form action={devSignIn} className="mt-5 grid gap-2">
            {members.map((m) => (
              <Button key={m.id} type="submit" name="userId" value={m.id} className="h-10 justify-between">
                <span>{m.name ?? m.email}</span>
                <span className="text-slate-11 capitalize">{m.role}</span>
              </Button>
            ))}
          </form>
        )}
      </>
    );
  }

  if (mode === "none") {
    return (
      <>
        <h1 className="text-title font-semibold">Sign-in is not configured</h1>
        <p className="mt-1 text-body text-slate-11">
          Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY, or DEV_AUTH=1 for local development.
        </p>
      </>
    );
  }

  return (
    <>
      <h1 className="text-title font-semibold">Sign in</h1>
      <p className="mt-1 text-body text-slate-11">Use the email your team invited.</p>
      <LoginForm />
    </>
  );
}

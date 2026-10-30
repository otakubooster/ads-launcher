import "server-only";
import { users, type UserRole } from "@fahd/db/schema";
import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { getDb } from "./db";
import { supabaseConfigured, supabaseServer } from "./supabase";

export const DEV_USER_COOKIE = "dev_user_id";

export type Session = {
  userId: string;
  email: string;
  name: string;
  role: UserRole;
  maxBudgetChangePct: number;
  /** Owners and admins must pass TOTP before using the app. */
  needsMfa: boolean;
};

export class ForbiddenError extends Error {
  constructor(message = "You don't have permission to do that.") {
    super(message);
  }
}

/**
 * "dev": pick a seeded member, only with DEV_AUTH=1 outside production.
 * "supabase": email + password with TOTP for owners and admins.
 */
export function authMode(): "dev" | "supabase" | "none" {
  if (process.env.DEV_AUTH === "1" && process.env.NODE_ENV !== "production") return "dev";
  return supabaseConfigured() ? "supabase" : "none";
}

async function loadMember(userId: string) {
  const [row] = await getDb().select().from(users).where(eq(users.id, userId));
  return row ?? null;
}

export const getSession = cache(async (): Promise<Session | null> => {
  const mode = authMode();
  let userId: string | null = null;
  let needsMfa = false;

  if (mode === "dev") {
    userId = (await cookies()).get(DEV_USER_COOKIE)?.value ?? null;
  } else if (mode === "supabase") {
    const supabase = await supabaseServer();
    const { data } = await supabase.auth.getUser();
    userId = data.user?.id ?? null;
    if (userId) {
      const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      needsMfa = aal?.currentLevel !== "aal2";
    }
  }
  if (!userId) return null;

  const member = await loadMember(userId);
  if (!member) return null;
  return {
    userId: member.id,
    email: member.email,
    name: member.name ?? member.email,
    role: member.role,
    maxBudgetChangePct: member.maxBudgetChangePct,
    needsMfa: needsMfa && (member.role === "owner" || member.role === "admin"),
  };
});

/** For pages: signed-in member or a redirect to login (or to the TOTP step). */
export async function requireSession() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.needsMfa) redirect("/mfa");
  return session;
}

/** For server actions: throws instead of redirecting. */
export async function requireRole(...roles: UserRole[]) {
  const session = await getSession();
  if (!session || session.needsMfa) throw new ForbiddenError("Sign in again to continue.");
  if (roles.length && !roles.includes(session.role)) throw new ForbiddenError();
  return session;
}

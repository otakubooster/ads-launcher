"use server";

import { users } from "@fahd/db/schema";
import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { DEV_USER_COOKIE, authMode } from "@/lib/server/auth";
import { getDb } from "@/lib/server/db";
import { supabaseServer } from "@/lib/server/supabase";

export type FormState = { error?: string; qr?: string; secret?: string; factorId?: string };

export async function devSignIn(formData: FormData) {
  if (authMode() !== "dev") throw new Error("Development sign-in is disabled");
  const userId = z.uuid().parse(formData.get("userId"));
  const [member] = await getDb().select({ id: users.id }).from(users).where(eq(users.id, userId));
  if (!member) throw new Error("Unknown member");
  (await cookies()).set(DEV_USER_COOKIE, member.id, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 7 * 86_400 });
  redirect("/dashboard");
}

const credentials = z.object({ email: z.email("Enter a valid email."), password: z.string().min(1, "Enter your password.") });

export async function signIn(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = credentials.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const supabase = await supabaseServer();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) return { error: "Email or password is incorrect." };
  redirect("/dashboard");
}

export async function signOut() {
  if (authMode() === "dev") (await cookies()).delete(DEV_USER_COOKIE);
  if (authMode() === "supabase") await (await supabaseServer()).auth.signOut();
  redirect("/login");
}

/** Starts TOTP enrolment, or returns the existing verified factor to challenge. */
export async function startMfa(): Promise<FormState> {
  const supabase = await supabaseServer();
  const { data: factors } = await supabase.auth.mfa.listFactors();
  const verified = factors?.totp.find((f) => f.status === "verified");
  if (verified) return { factorId: verified.id };
  for (const stale of factors?.all.filter((f) => f.status === "unverified") ?? []) {
    await supabase.auth.mfa.unenroll({ factorId: stale.id });
  }
  const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: "Authenticator app" });
  if (error || !data) return { error: "Could not start two-factor setup. Reload and try again." };
  return { factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret };
}

export async function verifyMfa(_prev: FormState, formData: FormData): Promise<FormState> {
  const factorId = String(formData.get("factorId") ?? "");
  const code = String(formData.get("code") ?? "").replace(/\s/g, "");
  if (!/^\d{6}$/.test(code)) return { factorId, error: "Enter the 6-digit code from your authenticator app." };
  const supabase = await supabaseServer();
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
  if (error) return { factorId, error: "That code didn't work. Codes change every 30 seconds; try the current one." };
  redirect("/dashboard");
}

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/server/auth";
import { MfaForm } from "./mfa-form";

export const metadata: Metadata = { title: "Two-factor authentication" };

export default async function MfaPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!session.needsMfa) redirect("/dashboard");
  return (
    <>
      <h1 className="text-title font-semibold">Two-factor authentication</h1>
      <p className="mt-1 text-body text-slate-11">Owners and admins confirm every sign-in with an authenticator app.</p>
      <MfaForm />
    </>
  );
}

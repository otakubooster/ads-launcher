"use client";

import { useActionState, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { startMfa, verifyMfa, type FormState } from "../actions";

export function MfaForm() {
  const [setup, setSetup] = useState<FormState | null>(null);
  const [state, action, pending] = useActionState<FormState, FormData>(verifyMfa, {});

  useEffect(() => {
    void startMfa().then(setSetup);
  }, []);

  if (!setup) return <Skeleton className="mt-5 h-40 w-full" />;
  if (setup.error) return <p role="alert" className="mt-5 text-ui text-red-11">{setup.error}</p>;

  return (
    <form action={action} className="mt-5 grid gap-4">
      {setup.qr && (
        <div className="grid gap-2">
          <p className="text-body">Scan this code with your authenticator app, then enter the 6-digit code.</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={setup.qr} alt="Two-factor QR code" className="size-40 rounded-card border border-slate-6 bg-white p-2" />
          <p className="text-label text-slate-11">
            Can&apos;t scan? Enter <code className="font-mono">{setup.secret}</code>
          </p>
        </div>
      )}
      <input type="hidden" name="factorId" value={setup.factorId} />
      <Field label="Code" htmlFor="code">
        <Input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={7} required autoFocus />
      </Field>
      {state.error && <p role="alert" className="text-ui text-red-11">{state.error}</p>}
      <Button type="submit" variant="primary" size="lg" disabled={pending}>
        {pending ? "Checking…" : "Verify"}
      </Button>
    </form>
  );
}

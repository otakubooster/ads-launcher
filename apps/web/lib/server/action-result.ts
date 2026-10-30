import "server-only";
import { MetaApiError, describeMetaError } from "@fahd/meta";
import { ZodError } from "zod";
import { ForbiddenError } from "./auth";

export type ActionResult<T = undefined> =
  | { ok: true; message?: string; data?: T }
  | { ok: false; error: { title: string; detail: string; fix?: string } };

/** Turns any thrown error into what failed, why and the fix, for the UI. */
export function toActionError(e: unknown): ActionResult<never> {
  if (e instanceof MetaApiError) return { ok: false, error: describeMetaError(e) };
  if (e instanceof ForbiddenError) return { ok: false, error: { title: "Not allowed", detail: e.message } };
  if (e instanceof ZodError) {
    const issue = e.issues[0];
    return { ok: false, error: { title: "Check the form", detail: issue?.message ?? "Some fields are invalid." } };
  }
  const message = e instanceof Error ? e.message : String(e);
  if (/row-level security|permission denied/.test(message)) {
    return { ok: false, error: { title: "Not allowed", detail: "Your role can't make this change." } };
  }
  console.error(e);
  return { ok: false, error: { title: "Something went wrong", detail: message, fix: "Try again. If it keeps failing, check the server logs." } };
}

export async function runAction<T>(fn: () => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  try {
    return await fn();
  } catch (e) {
    if (e && typeof e === "object" && "digest" in e && String((e as { digest: unknown }).digest).startsWith("NEXT_REDIRECT")) throw e;
    return toActionError(e);
  }
}

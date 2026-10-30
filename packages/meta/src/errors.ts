/**
 * Meta error codes → what the app does about them (docs/spec.md → Error handling).
 *
 *   rate_limit   4, 17, 32, 613, 80000–80014   back off per headers, retry up to 3 times
 *   temporary    1, 2                           retry twice: after 2 s, then 8 s
 *   auth         190, 102                       stop all jobs, mark connection broken, alert owner
 *   permission   10, 200–299                    stop, show which permission and asset to fix
 *   validation   100                            no retry; show error_user_title + error_user_msg
 *   policy       368                            stop the whole launch, alert owner
 *   timeout      request exceeded the timeout   writes are ambiguous: look the object up before retrying
 *   network      no response                    same
 *   guard        refused before sending         e.g. a create without status PAUSED
 */
export type MetaErrorKind =
  | "rate_limit"
  | "temporary"
  | "auth"
  | "permission"
  | "validation"
  | "policy"
  | "timeout"
  | "network"
  | "guard"
  | "unknown";

/** Meta's error object, as it appears under `error` in a Graph response body. */
export type GraphErrorBody = {
  message?: string;
  type?: string;
  code?: number;
  error_subcode?: number;
  is_transient?: boolean;
  error_user_title?: string;
  error_user_msg?: string;
  fbtrace_id?: string;
};

export class MetaApiError extends Error {
  override readonly name = "MetaApiError";
  readonly kind: MetaErrorKind;
  readonly code: number | null;
  readonly subcode: number | null;
  readonly httpStatus: number | null;
  readonly userTitle: string | null;
  readonly userMessage: string | null;
  readonly fbtraceId: string | null;
  /** How long Meta asked us to wait, when the response said. */
  readonly retryAfterMs: number | null;
  /** True when a write may or may not have happened (timeout, dropped connection). */
  readonly ambiguous: boolean;

  constructor(init: {
    kind: MetaErrorKind;
    message: string;
    code?: number | null;
    subcode?: number | null;
    httpStatus?: number | null;
    userTitle?: string | null;
    userMessage?: string | null;
    fbtraceId?: string | null;
    retryAfterMs?: number | null;
    ambiguous?: boolean;
    cause?: unknown;
  }) {
    super(init.message, { cause: init.cause });
    this.kind = init.kind;
    this.code = init.code ?? null;
    this.subcode = init.subcode ?? null;
    this.httpStatus = init.httpStatus ?? null;
    this.userTitle = init.userTitle ?? null;
    this.userMessage = init.userMessage ?? null;
    this.fbtraceId = init.fbtraceId ?? null;
    this.retryAfterMs = init.retryAfterMs ?? null;
    this.ambiguous = init.ambiguous ?? false;
  }

  /** Stops every job for the connection (token broken). */
  get stopsConnection() {
    return this.kind === "auth";
  }

  /** Stops the whole launch, not just this item. */
  get stopsLaunch() {
    return this.kind === "auth" || this.kind === "policy" || this.kind === "permission";
  }

  /** The owner should get an email (docs/spec.md → Audit and safety). */
  get alertsOwner() {
    return this.kind === "auth" || this.kind === "policy";
  }
}

export function classifyCode(code: number | undefined, isTransient = false): MetaErrorKind {
  if (code === undefined) return isTransient ? "temporary" : "unknown";
  if ([4, 17, 32, 613].includes(code) || (code >= 80000 && code <= 80014)) return "rate_limit";
  if (code === 1 || code === 2) return "temporary";
  if (code === 190 || code === 102) return "auth";
  if (code === 10 || (code >= 200 && code <= 299)) return "permission";
  if (code === 100) return "validation";
  if (code === 368) return "policy";
  return isTransient ? "temporary" : "unknown";
}

export function errorFromGraph(
  body: GraphErrorBody | undefined,
  httpStatus: number,
  retryAfterMs: number | null = null,
): MetaApiError {
  const kind = body?.code === undefined && httpStatus >= 500 ? "temporary" : classifyCode(body?.code, body?.is_transient);
  return new MetaApiError({
    kind,
    message: body?.message ?? `Meta returned HTTP ${httpStatus}`,
    code: body?.code,
    subcode: body?.error_subcode,
    httpStatus,
    userTitle: body?.error_user_title,
    userMessage: body?.error_user_msg,
    fbtraceId: body?.fbtrace_id,
    retryAfterMs: kind === "rate_limit" ? retryAfterMs : null,
  });
}

/** What failed, why, and the fix, in plain language (docs/spec.md → States every screen handles). */
export function describeMetaError(err: MetaApiError): { title: string; detail: string; fix: string } {
  const minutes = err.retryAfterMs ? Math.max(1, Math.ceil(err.retryAfterMs / 60_000)) : null;
  switch (err.kind) {
    case "validation":
      return {
        title: err.userTitle ?? "Meta rejected a setting",
        detail: err.userMessage ?? err.message,
        fix: "Change the highlighted setting and try again.",
      };
    case "rate_limit":
      return {
        title: "Meta is rate limiting this ad account",
        detail: "Too many requests in the current window.",
        fix: minutes ? `Requests resume automatically in about ${minutes} min.` : "Requests resume automatically shortly.",
      };
    case "temporary":
      return {
        title: "Meta had a temporary problem",
        detail: err.message,
        fix: "Retry in a few minutes. If it keeps failing, check Meta's status page.",
      };
    case "auth":
      return {
        title: "The Meta connection stopped working",
        detail: "The system user token is invalid, expired or was revoked.",
        fix: "Generate a new system user token and use Replace token in Settings → Meta connections.",
      };
    case "permission":
      return {
        title: "Missing permission on Meta",
        detail: err.userMessage ?? err.message,
        fix: "In Business Settings, give the system user full control of this asset, and check the token has every required permission.",
      };
    case "policy":
      return {
        title: "Meta blocked this for policy reasons",
        detail: err.userMessage ?? err.message,
        fix: "Review the ad account in Meta's Account Quality before launching again.",
      };
    case "timeout":
    case "network":
      return {
        title: "No answer from Meta",
        detail: err.message,
        fix: err.ambiguous
          ? "The change may already have been made. Refresh before trying again."
          : "Check the connection and try again.",
      };
    case "guard":
      return { title: "Request blocked", detail: err.message, fix: "Create objects paused, then activate them separately." };
    default:
      return {
        title: err.userTitle ?? "Meta returned an error",
        detail: err.userMessage ?? err.message,
        fix: err.fbtraceId ? `Contact support with trace ID ${err.fbtraceId}.` : "Try again later.",
      };
  }
}

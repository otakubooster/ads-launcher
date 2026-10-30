import { createHmac } from "node:crypto";
import { DEFAULT_API_VERSION, LIMITS, graphHost } from "./config";
import { MetaApiError, errorFromGraph, type GraphErrorBody } from "./errors";
import { assertPausedCreate } from "./guards";
import { Throttle } from "./throttle";
import { parseUsage, waitFromUsage, type UsageSnapshot } from "./usage";

export type Method = "GET" | "POST" | "DELETE";
export type ParamValue = string | number | boolean | null | undefined | object;
export type Params = Record<string, ParamValue>;

export type RequestOptions = {
  /** act_… id used for throttling and usage; read from the path when it starts with act_. */
  accountId?: string;
  signal?: AbortSignal;
};

export type UsageEvent = { accountId: string | null; usage: UsageSnapshot; at: Date };

/** Safe to log: never contains the token, params or response bodies. */
export type LogEvent = {
  method: Method;
  path: string;
  accountId: string | null;
  attempt: number;
  status: number | null;
  durationMs: number;
  errorKind?: string;
  errorCode?: number | null;
  usagePct?: number;
};

export type MetaClientOptions = {
  /** Decrypted system user token. Server code only. */
  accessToken: string;
  /** Signs every call with appsecret_proof. */
  appSecret: string;
  version?: string;
  throttle?: Throttle;
  /** Write an api_usage row here (the worker does). */
  onUsage?: (event: UsageEvent) => void | Promise<void>;
  log?: (event: LogEvent) => void;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  timeoutMs?: number;
};

export type BatchRequest = {
  method: Method;
  /** Relative to the version, e.g. "act_123/adcreatives". */
  relativeUrl: string;
  params?: Params;
  /** Lets later requests use {result=<name>:$.id}. */
  name?: string;
};

export type BatchResult<T = unknown> = { ok: true; body: T } | { ok: false; error: MetaApiError };

type GraphPage<T> = { data: T[]; paging?: { cursors?: { after?: string }; next?: string } };

/** Retry rules (docs/spec.md → Rate limits, Error handling). Null means give up. */
export function retryDelay(err: MetaApiError, retriesSoFar: number, method: Method): number | null {
  if (retriesSoFar >= LIMITS.maxRetries) return null;
  switch (err.kind) {
    case "rate_limit": {
      const wait = err.retryAfterMs ?? 2_000 * 4 ** retriesSoFar;
      return wait <= LIMITS.maxInlineWaitMs ? wait : null;
    }
    case "temporary":
      return LIMITS.temporaryBackoffMs[retriesSoFar] ?? null;
    case "timeout":
    case "network":
      // A write may have landed; the caller looks it up by name before retrying.
      return method === "GET" ? (LIMITS.temporaryBackoffMs[retriesSoFar] ?? null) : null;
    default:
      return null;
  }
}

export function normalizePath(path: string) {
  return path.replace(/^\/+/, "").replace(/^v\d+\.\d+\//, "");
}

export function accountFromPath(path: string) {
  return /^(act_\d+)(\/|$)/.exec(normalizePath(path))?.[1] ?? null;
}

export function encodeParams(params: Params = {}) {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    out[key] = value !== null && typeof value === "object" ? JSON.stringify(value) : String(value);
  }
  return out;
}

export class MetaClient {
  readonly version: string;
  private readonly token: string;
  private readonly proof: string;
  private readonly throttle: Throttle;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private readonly timeoutMs: number;
  private readonly onUsage?: MetaClientOptions["onUsage"];
  private readonly log?: MetaClientOptions["log"];

  constructor(opts: MetaClientOptions) {
    if (!opts.accessToken) throw new Error("Meta access token is missing");
    if (!opts.appSecret) throw new Error("META_APP_SECRET is missing");
    this.version = opts.version ?? process.env.META_API_VERSION ?? DEFAULT_API_VERSION;
    this.token = opts.accessToken;
    this.proof = createHmac("sha256", opts.appSecret).update(opts.accessToken).digest("hex");
    this.now = opts.now ?? Date.now;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.throttle = opts.throttle ?? new Throttle({ now: this.now, sleep: this.sleep });
    this.fetchImpl = opts.fetch ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? LIMITS.requestTimeoutMs;
    this.onUsage = opts.onUsage;
    this.log = opts.log;
  }

  get<T>(path: string, params?: Params, options?: RequestOptions) {
    return this.request<T>("GET", path, params, options);
  }

  post<T>(path: string, params?: Params, options?: RequestOptions) {
    return this.request<T>("POST", path, params, options);
  }

  delete<T>(path: string, params?: Params, options?: RequestOptions) {
    return this.request<T>("DELETE", path, params, options);
  }

  /** Follows cursor paging until the last page. */
  async *paginate<T>(path: string, params: Params = {}, options?: RequestOptions): AsyncGenerator<T> {
    let after: string | undefined;
    do {
      const page = await this.get<GraphPage<T>>(path, { ...params, after }, options);
      yield* page.data;
      after = page.paging?.next ? page.paging.cursors?.after : undefined;
    } while (after);
  }

  /** Up to 50 requests in one call; each result succeeds or fails on its own. */
  async batch<T = unknown>(requests: BatchRequest[], options?: RequestOptions): Promise<BatchResult<T>[]> {
    if (requests.length === 0) return [];
    if (requests.length > LIMITS.maxBatchSize) {
      throw new MetaApiError({ kind: "guard", message: `A batch holds at most ${LIMITS.maxBatchSize} requests` });
    }
    const encoded = requests.map((r) => {
      const relativeUrl = normalizePath(r.relativeUrl);
      assertPausedCreate(r.method, relativeUrl, r.params);
      const fields = batchEncode(r.params);
      return {
        method: r.method,
        name: r.name,
        relative_url: r.method === "GET" && fields ? `${relativeUrl}?${fields}` : relativeUrl,
        body: r.method === "GET" ? undefined : fields || undefined,
      };
    });
    const accountId = options?.accountId ?? accountFromPath(requests[0]!.relativeUrl);
    const raw = await this.request<({ code: number; body: string } | null)[]>(
      "POST",
      "",
      { batch: encoded, include_headers: false },
      { ...options, accountId: accountId ?? undefined },
    );
    return raw.map((item): BatchResult<T> => {
      if (!item) {
        return {
          ok: false,
          error: new MetaApiError({ kind: "unknown", message: "No result: a request this one depended on failed" }),
        };
      }
      const body = safeJson(item.body) as { error?: GraphErrorBody } | null;
      if (item.code >= 200 && item.code < 300 && !body?.error) return { ok: true, body: body as T };
      return { ok: false, error: errorFromGraph(body?.error, item.code) };
    });
  }

  async request<T>(method: Method, rawPath: string, params?: Params, options: RequestOptions = {}): Promise<T> {
    const path = normalizePath(rawPath);
    assertPausedCreate(method, path, params);
    const accountId = options.accountId ?? accountFromPath(path);

    for (let retries = 0; ; retries++) {
      const started = this.now();
      let status: number | null = null;
      let usage: UsageSnapshot | null = null;
      let error: MetaApiError;
      try {
        const res = await this.throttle.run(accountId, method === "GET" ? "read" : "write", () =>
          this.send(method, path, params, options.signal),
        );
        status = res.status;
        usage = parseUsage(res.headers);
        if (usage) await this.reportUsage(accountId, usage);
        const body = safeJson(await res.text()) as ({ error?: GraphErrorBody } & T) | null;
        if (res.ok && !body?.error) {
          this.emit({ method, path, accountId, attempt: retries, status, durationMs: this.now() - started, usagePct: usage?.maxPct });
          return body as T;
        }
        error = errorFromGraph(body?.error, res.status, waitFromUsage(usage));
      } catch (e) {
        error = e instanceof MetaApiError ? e : this.transportError(e, method);
      }

      this.emit({
        method,
        path,
        accountId,
        attempt: retries,
        status,
        durationMs: this.now() - started,
        errorKind: error.kind,
        errorCode: error.code,
        usagePct: usage?.maxPct,
      });
      const delay = retryDelay(error, retries, method);
      if (error.kind === "rate_limit" && accountId) {
        this.throttle.block(accountId, this.now() + (error.retryAfterMs ?? delay ?? LIMITS.defaultPauseMs));
      }
      if (delay === null) throw error;
      // Rate-limit waits are taken by the throttle (it was just blocked).
      if (!(error.kind === "rate_limit" && accountId)) await this.sleep(delay);
    }
  }

  private send(method: Method, path: string, params: Params | undefined, signal?: AbortSignal) {
    const url = new URL(`${graphHost()}/${this.version}/${path}`);
    const fields = new URLSearchParams({ ...encodeParams(params), appsecret_proof: this.proof });
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const init: RequestInit = {
      method,
      // In a header, never the URL, so tokens stay out of logs and traces.
      headers: { Authorization: `Bearer ${this.token}` },
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    };
    if (method === "POST") init.body = fields;
    else url.search = fields.toString();
    return this.fetchImpl(url, init);
  }

  private transportError(e: unknown, method: Method) {
    const timedOut = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    return new MetaApiError({
      kind: timedOut ? "timeout" : "network",
      message: timedOut ? "Meta did not answer in time" : "Could not reach Meta",
      ambiguous: method !== "GET",
      cause: e,
    });
  }

  private async reportUsage(accountId: string | null, usage: UsageSnapshot) {
    if (accountId) this.throttle.record(accountId, usage);
    try {
      await this.onUsage?.({ accountId, usage, at: new Date(this.now()) });
    } catch {
      // Usage bookkeeping must never fail a Meta call.
    }
  }

  private emit(event: LogEvent) {
    try {
      this.log?.(event);
    } catch {
      // Logging must never fail a Meta call.
    }
  }
}

/**
 * Form-encodes a batch body but leaves {result=name:$.path} references readable:
 * Meta resolves them in the raw body text before decoding it.
 */
export function batchEncode(params?: Params) {
  return new URLSearchParams(encodeParams(params))
    .toString()
    .replace(/%7Bresult%3D.*?%7D/g, (ref) => decodeURIComponent(ref));
}

function safeJson(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function createMetaClient(opts: MetaClientOptions) {
  return new MetaClient(opts);
}

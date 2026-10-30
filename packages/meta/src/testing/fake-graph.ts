import { createHash } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

/**
 * A stateful stand-in for the Graph API, for local development and end-to-end
 * tests (META_GRAPH_HOST=http://localhost:4010). It answers the calls the app
 * makes, in Meta's response format, and never talks to Meta.
 *
 * Any Bearer token starting with "EAAFAKE" is valid. Control endpoints:
 *   POST /__fake/fail   {"match": "regex on METHOD path", "status": 400, "error": {...}, "times": 1}
 *   POST /__fake/reset  restore the initial state
 *   GET  /__fake/state  everything the fake holds
 */

type Obj = Record<string, unknown> & { id: string; type: string; account_id?: string };
type Failure = { match: RegExp; status: number; error: Record<string, unknown>; times: number };

export const FAKE_BUSINESS_ID = "100000000000001";
export const FAKE_TOKEN_PREFIX = "EAAFAKE";
/** Meta hands out video upload chunks; the fake uses 50 MB. */
const CHUNK = 50 * 1024 * 1024;

const ACCOUNTS = [
  { id: "act_200000000000001", name: "Lumen US", currency: "USD", timezone_name: "America/New_York" },
  { id: "act_200000000000002", name: "Lumen UK", currency: "GBP", timezone_name: "Europe/London" },
  { id: "act_200000000000003", name: "Arbor FR", currency: "EUR", timezone_name: "Europe/Paris" },
];

function initialState() {
  const objects = new Map<string, Obj>();
  let seq = 0;
  const id = () => `23${String(++seq).padStart(14, "0")}`;
  const add = (o: Omit<Obj, "id"> & { id?: string }) => {
    const obj = { ...o, id: o.id ?? id() } as Obj;
    objects.set(obj.id, obj);
    return obj;
  };

  ACCOUNTS.forEach((a, ai) => {
    add({ ...a, type: "adaccount", account_status: 1, amount_spent: String(1_000_000 * (ai + 1)) });
    add({ id: `30000000000000${ai + 1}`, type: "page", name: `${a.name.split(" ")[0]} page`, business: FAKE_BUSINESS_ID });
    add({ id: `40000000000000${ai + 1}`, type: "instagram", username: `${a.name.toLowerCase().replace(" ", "_")}`, account_id: a.id });
    add({ id: `50000000000000${ai + 1}`, type: "pixel", name: `${a.name} pixel`, account_id: a.id });
    for (let c = 0; c < 2; c++) {
      const campaign = add({
        type: "campaign",
        account_id: a.id,
        name: `${a.name.replace(" ", "_")}_${c === 0 ? "Prospecting" : "Scaling"}`,
        status: "ACTIVE",
        effective_status: "ACTIVE",
        objective: "OUTCOME_SALES",
        bid_strategy: "LOWEST_COST_WITHOUT_CAP",
        daily_budget: c === 0 ? "15000" : "40000",
      });
      for (let s = 0; s < 2; s++) {
        const paused = c === 1 && s === 1;
        const adset = add({
          type: "adset",
          account_id: a.id,
          campaign_id: campaign.id,
          name: `${a.name.replace(" ", "_")}_${s === 0 ? "glow" : "routine"}_${c * 2 + s + 1}`,
          status: paused ? "PAUSED" : "ACTIVE",
          effective_status: paused ? "PAUSED" : "ACTIVE",
          optimization_goal: "OFFSITE_CONVERSIONS",
          billing_event: "IMPRESSIONS",
          targeting: { geo_locations: { countries: [a.currency === "EUR" ? "FR" : a.currency === "GBP" ? "GB" : "US"] } },
        });
        for (let d = 0; d < 3; d++) {
          const effective = paused ? "ADSET_PAUSED" : ["ACTIVE", "ACTIVE", "IN_PROCESS", "DISAPPROVED", "ACTIVE", "WITH_ISSUES"][(ai + c + s + d) % 6];
          const creative = add({ type: "adcreative", account_id: a.id, name: `hook${d + 1} creative`, thumbnail_url: thumb(`hook${d + 1}`) });
          add({
            type: "ad",
            account_id: a.id,
            campaign_id: campaign.id,
            adset_id: adset.id,
            name: `hook${d + 1}_ugc_${d + 1}`,
            status: "ACTIVE",
            effective_status: effective,
            creative: { id: creative.id, thumbnail_url: creative.thumbnail_url },
          });
        }
      }
    }
  });
  return { objects, seq, failures: [] as Failure[], videoPolls: new Map<string, number>() };
}

function thumb(seed: string) {
  const hue = Number.parseInt(createHash("md5").update(seed).digest("hex").slice(0, 2), 16);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="108" height="192"><rect width="108" height="192" fill="hsl(${hue},45%,62%)"/><text x="54" y="100" font-family="sans-serif" font-size="14" fill="white" text-anchor="middle">${seed}</text></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

/** Stable pseudo-random number in [0, 1) for a key. */
function unit(key: string) {
  return Number.parseInt(createHash("sha1").update(key).digest("hex").slice(0, 8), 16) / 0xffffffff;
}

function insightRow(ad: Obj, date: string) {
  const r = (k: string, min: number, max: number) => min + unit(`${ad.id}:${date}:${k}`) * (max - min);
  if (ad.effective_status !== "ACTIVE" && ad.effective_status !== "WITH_ISSUES") return null;
  const spend = r("spend", 20, 300);
  const impressions = Math.round((spend / r("cpm", 8, 20)) * 1000);
  const clicks = Math.round(impressions * r("ctr", 0.006, 0.02));
  const purchases = Math.round(clicks * r("cvr", 0.015, 0.045));
  const value = purchases * r("aov", 45, 75);
  const plays = Math.round(impressions * r("hook", 0.22, 0.4));
  const thru = Math.round(impressions * r("hold", 0.07, 0.15));
  return {
    account_id: String(ad.account_id).replace("act_", ""),
    campaign_id: ad.campaign_id,
    adset_id: ad.adset_id,
    ad_id: ad.id,
    date_start: date,
    date_stop: date,
    spend: spend.toFixed(2),
    impressions: String(impressions),
    inline_link_clicks: String(clicks),
    actions: [
      { action_type: "purchase", value: String(purchases) },
      { action_type: "video_view", value: String(plays) },
    ],
    action_values: [{ action_type: "purchase", value: value.toFixed(2) }],
    video_thruplay_watched_actions: [{ action_type: "video_view", value: String(thru) }],
  };
}

function days(since: string, until: string) {
  const out: string[] = [];
  for (let d = new Date(`${since}T00:00:00Z`); d <= new Date(`${until}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

function graphError(code: number, message: string, extra: Record<string, unknown> = {}) {
  return { error: { message, type: "OAuthException", code, fbtrace_id: "FAKEtrace", ...extra } };
}

export function createFakeGraph() {
  let state = initialState();
  const reports = new Map<string, { accountId: string; since: string; until: string }>();

  const nextId = () => `23${String(++state.seq).padStart(14, "0")}`;
  const list = (type: string, accountId?: string) =>
    [...state.objects.values()].filter((o) => o.type === type && (!accountId || o.account_id === accountId));
  const page = (data: unknown[]) => ({ data, paging: { cursors: { before: "MA", after: "MA" } } });

  function handle(method: string, path: string, params: Record<string, string>): [number, unknown] {
    const parts = path.split("/").filter(Boolean);
    const [head, edge] = parts;
    const json = (k: string) => {
      try {
        return JSON.parse(params[k] ?? "null");
      } catch {
        return params[k];
      }
    };

    if (method === "POST" && parts.length === 0 && params.batch) {
      const results: Record<string, string> = {};
      const out = (json("batch") as { method: string; relative_url: string; body?: string; name?: string }[]).map((req) => {
        const resolve = (s: string) => s.replace(/\{result=([^:]+):\$\.id\}/g, (_, n: string) => results[n] ?? "");
        const [p, query] = resolve(req.relative_url).split("?");
        const body = Object.fromEntries(new URLSearchParams(resolve(req.body ?? query ?? "")));
        const [code, res] = handle(req.method, p!.replace(/^v\d+\.\d+\//, ""), body);
        if (req.name && code === 200) results[req.name] = (res as { id?: string }).id ?? "";
        return { code, body: JSON.stringify(res) };
      });
      return [200, out];
    }

    if (head === "me" && !edge) return [200, { id: "61550000000001", name: "fahd-ads-launcher" }];
    if (head === "me" && edge === "permissions") {
      return [200, { data: ["ads_management", "ads_read", "business_management", "pages_show_list", "pages_read_engagement", "pages_manage_ads", "pages_manage_metadata", "instagram_basic"].map((permission) => ({ permission, status: "granted" })) }];
    }
    if (head === FAKE_BUSINESS_ID && !edge) return [200, { id: FAKE_BUSINESS_ID, name: "Fahd Holdings (fake)" }];
    if (head === FAKE_BUSINESS_ID && edge === "owned_ad_accounts") return [200, page(list("adaccount").map(strip))];
    if (head === FAKE_BUSINESS_ID && edge === "client_ad_accounts") return [200, page([])];
    if (head === FAKE_BUSINESS_ID && edge === "owned_pages") return [200, page(list("page").map(strip))];

    if (head?.startsWith("act_")) {
      if (!state.objects.has(head)) return [400, graphError(100, `Unsupported get request. Object with ID '${head}' does not exist`)];
      if (method === "GET" && edge === "instagram_accounts") return [200, page(list("instagram", head).map(strip))];
      if (method === "GET" && edge === "adspixels") return [200, page(list("pixel", head).map(strip))];
      if (method === "GET" && (edge === "campaigns" || edge === "adsets" || edge === "ads")) {
        const filtering = (json("filtering") as { field: string; operator: string; value: string }[] | null) ?? [];
        const byName = filtering.find((f) => f.field === "name" && f.operator === "EQUAL")?.value;
        return [200, page(list(edge.slice(0, -1), head).filter((o) => o.status !== "DELETED" && (!byName || o.name === byName)).map(strip))];
      }
      if (method === "GET" && edge === "insights") {
        const range = json("time_range") as { since: string; until: string } | null;
        const today = new Date().toISOString().slice(0, 10);
        const span = range ?? { since: today, until: today };
        return [200, page(list("ad", head).flatMap((ad) => days(span.since, span.until).map((d) => insightRow(ad, d)).filter(Boolean)))];
      }
      if (method === "POST" && edge === "insights") {
        const range = json("time_range") as { since: string; until: string };
        const id = nextId();
        reports.set(id, { accountId: head, ...range });
        return [200, { report_run_id: id }];
      }
      if (method === "POST" && (edge === "campaigns" || edge === "adsets" || edge === "ads")) {
        if (params.status !== "PAUSED") return [400, graphError(100, "Fake Graph only accepts PAUSED creates")];
        if (!params.name) return [400, graphError(100, "Invalid parameter", { error_user_title: "Name missing", error_user_msg: "Give this object a name." })];
        const type = edge.slice(0, -1);
        const obj: Obj = { id: nextId(), type, account_id: head, effective_status: "PAUSED", created_time: new Date().toISOString() };
        for (const [k, v] of Object.entries(params)) obj[k] = json(k) ?? v;
        if (type === "ad") {
          const creativeId = (obj.creative as { creative_id?: string })?.creative_id;
          const creative = creativeId ? state.objects.get(creativeId) : undefined;
          if (!creative) return [400, graphError(100, "Invalid parameter", { error_user_title: "Creative not found", error_user_msg: "The ad's creative does not exist." })];
          obj.creative = { id: creative.id, thumbnail_url: creative.thumbnail_url };
          const adset = state.objects.get(String(obj.adset_id));
          obj.campaign_id = adset?.campaign_id;
        }
        state.objects.set(obj.id, obj);
        return [200, { id: obj.id }];
      }
      if (method === "POST" && edge === "adcreatives") {
        const obj: Obj = { id: nextId(), type: "adcreative", account_id: head, thumbnail_url: thumb(params.name ?? "creative") };
        for (const [k, v] of Object.entries(params)) obj[k] = json(k) ?? v;
        state.objects.set(obj.id, obj);
        return [200, { id: obj.id }];
      }
      if (method === "POST" && edge === "adimages") {
        const hash = createHash("md5").update(params.bytes ?? params.filename ?? String(Math.random())).digest("hex");
        const name = params.filename ?? "image";
        return [200, { images: { [name]: { hash, url: thumb(name) } } }];
      }
      if (method === "POST" && edge === "advideos") {
        if (params.upload_phase === "start") {
          const id = nextId();
          state.objects.set(id, { id, type: "advideo", account_id: head, size: Number(params.file_size) });
          return [200, { upload_session_id: `${id}s`, video_id: id, start_offset: "0", end_offset: String(Math.min(Number(params.file_size), CHUNK)) }];
        }
        if (params.upload_phase === "transfer") {
          const video = state.objects.get(params.upload_session_id!.slice(0, -1));
          const size = Number(video?.size ?? 0);
          const next = Number(params.start_offset) + Number(params.chunk_size ?? 0);
          if (video) video.received = next;
          return [200, { start_offset: String(next), end_offset: String(Math.min(next + CHUNK, size)) }];
        }
        if (params.upload_phase === "finish") return [200, { success: true }];
        const id = nextId();
        state.objects.set(id, { id, type: "advideo", account_id: head, file_url: params.file_url });
        return [200, { id }];
      }
    }

    const report = head ? reports.get(head) : undefined;
    if (report && method === "GET" && edge === "insights") {
      return [200, page(list("ad", report.accountId).flatMap((ad) => days(report.since, report.until).map((d) => insightRow(ad, d)).filter(Boolean)))];
    }
    if (report && method === "GET" && !edge) return [200, { id: head, async_status: "Job Completed", async_percent_completion: 100 }];

    const obj = head ? state.objects.get(head) : undefined;
    if (!obj) return [400, graphError(100, `Unsupported request. Object with ID '${head}' does not exist`)];

    if (method === "GET" && obj.type === "advideo" && !edge) {
      const polls = (state.videoPolls.get(obj.id) ?? 0) + 1;
      state.videoPolls.set(obj.id, polls);
      return [200, { id: obj.id, status: { video_status: polls >= 2 ? "ready" : "processing", processing_progress: polls >= 2 ? 100 : 50 } }];
    }
    if (method === "GET" && edge === "thumbnails") {
      return [200, { data: [{ id: `${obj.id}t`, uri: thumb(obj.id), is_preferred: true, width: 1080, height: 1920 }] }];
    }
    if (method === "GET" && edge === "previews") {
      return [200, { data: [{ body: `<iframe src="about:blank" width="320" height="568" data-format="${params.ad_format}"></iframe>` }] }];
    }
    if (method === "GET" && (edge === "adsets" || edge === "ads") && (obj.type === "campaign" || obj.type === "adset")) {
      const parentKey = obj.type === "campaign" ? "campaign_id" : "adset_id";
      return [200, page([...state.objects.values()].filter((o) => o.type === edge.slice(0, -1) && o[parentKey] === obj.id && o.status !== "DELETED").map(strip))];
    }
    if (method === "POST" && edge === "copies") {
      if (params.status_option !== "PAUSED") return [400, graphError(100, "Fake Graph only accepts PAUSED copies")];
      const copy: Obj = { ...obj, id: nextId(), name: `${String(obj.name)} - Copy`, status: "PAUSED", effective_status: "PAUSED", created_time: new Date().toISOString() };
      if (params.campaign_id) copy.campaign_id = params.campaign_id;
      state.objects.set(copy.id, copy);
      return [200, obj.type === "campaign" ? { copied_campaign_id: copy.id } : obj.type === "ad" ? { copied_ad_id: copy.id } : { copied_adset_id: copy.id }];
    }
    if (method === "GET" && !edge) return [200, strip(obj)];
    if (method === "POST" && !edge) {
      for (const [k, v] of Object.entries(params)) obj[k] = json(k) ?? v;
      if (params.status) obj.effective_status = params.status === "ACTIVE" ? "ACTIVE" : params.status;
      if (params.status && obj.type !== "ad") {
        for (const child of state.objects.values()) {
          if (child.type === "ad" && (child.adset_id === obj.id || child.campaign_id === obj.id) && child.status === "ACTIVE") {
            child.effective_status = params.status === "PAUSED" ? (obj.type === "adset" ? "ADSET_PAUSED" : "CAMPAIGN_PAUSED") : "ACTIVE";
          }
        }
      }
      return [200, { success: true }];
    }
    if (method === "DELETE") {
      obj.status = "DELETED";
      return [200, { success: true }];
    }
    return [400, graphError(100, `Unsupported ${method} request on ${path}`)];
  }

  function strip(o: Obj) {
    const { type: _type, ...rest } = o;
    void _type;
    return rest;
  }

  async function readBody(req: IncomingMessage) {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const raw = Buffer.concat(chunks);
    const type = req.headers["content-type"] ?? "";
    if (type.includes("multipart/form-data")) {
      const form = await new Response(raw, { headers: { "content-type": type } }).formData();
      const out: Record<string, string> = {};
      for (const [k, v] of form.entries()) {
        if (typeof v === "string") out[k] = v;
        else {
          out.filename = v.name;
          out.bytes = createHash("md5").update(Buffer.from(await v.arrayBuffer())).digest("hex");
          if (k === "video_file_chunk") out.chunk_size = String(v.size);
        }
      }
      return out;
    }
    if (type.includes("application/json")) return JSON.parse(raw.toString() || "{}") as Record<string, string>;
    return Object.fromEntries(new URLSearchParams(raw.toString()));
  }

  async function onRequest(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? "/", "http://fake");
    const send = (status: number, body: unknown, headers: Record<string, string> = {}) => {
      res.writeHead(status, { "content-type": "application/json", ...headers });
      res.end(JSON.stringify(body));
    };

    if (url.pathname.startsWith("/__fake/")) {
      const body = req.method === "POST" ? await readBody(req) : {};
      if (url.pathname === "/__fake/reset") {
        state = initialState();
        reports.clear();
        return send(200, { ok: true });
      }
      if (url.pathname === "/__fake/fail") {
        const b = body as unknown as { match: string; status?: number; error: Record<string, unknown>; times?: number };
        state.failures.push({ match: new RegExp(b.match), status: b.status ?? 400, error: b.error, times: b.times ?? 1 });
        return send(200, { ok: true });
      }
      return send(200, { objects: [...state.objects.values()], failures: state.failures.length });
    }

    const auth = req.headers.authorization ?? "";
    if (!auth.startsWith(`Bearer ${FAKE_TOKEN_PREFIX}`)) {
      return send(400, graphError(190, "Invalid OAuth access token - Cannot parse access token", { error_subcode: 463 }));
    }

    const path = url.pathname.replace(/^\/v\d+\.\d+\/?/, "");
    const params = { ...Object.fromEntries(url.searchParams), ...(req.method === "POST" ? await readBody(req) : {}) };
    if (!params.appsecret_proof) return send(400, graphError(100, "appsecret_proof required"));

    const signature = `${req.method} ${path}`;
    const failure = state.failures.find((f) => f.match.test(signature));
    if (failure) {
      failure.times -= 1;
      if (failure.times <= 0) state.failures.splice(state.failures.indexOf(failure), 1);
      return send(failure.status, { error: { type: "OAuthException", fbtrace_id: "FAKEforced", ...failure.error } });
    }

    const [status, body] = handle(req.method ?? "GET", path, params);
    const account = /^act_\d+/.exec(path)?.[0] ?? params.account_id;
    const usage: Record<string, string> = account
      ? { "x-ad-account-usage": JSON.stringify({ acc_id_util_pct: 3.2, reset_time_duration: 0, ads_api_access_tier: "development_access" }) }
      : {};
    send(status, body, usage);
  }

  const server: Server = createServer((req, res) => {
    onRequest(req, res).catch((e: unknown) => {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify(graphError(1, `Fake Graph crashed: ${(e as Error).message}`)));
    });
  });

  return {
    server,
    listen(port = 0) {
      return new Promise<string>((resolve) => {
        server.listen(port, "127.0.0.1", () => {
          const address = server.address();
          resolve(`http://127.0.0.1:${typeof address === "object" && address ? address.port : port}`);
        });
      });
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
    get objects() {
      return state.objects;
    },
  };
}

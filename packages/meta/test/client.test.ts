import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  MetaApiError,
  Throttle,
  createMetaClient,
  describeMetaError,
  getTokenPermissions,
  listBusinessAdAccounts,
  missingPermissions,
  setDailyBudget,
  type LogEvent,
  type UsageEvent,
} from "../src";
import { fakeClock, fixture, replay } from "./replay";

const TOKEN = "EAAtestSystemUserToken1234";
const SECRET = "app-secret";
const ACT = "act_200000000000001";

function setup(...steps: Parameters<typeof replay>) {
  const server = replay(...steps);
  const clock = fakeClock();
  const usage: UsageEvent[] = [];
  const logs: LogEvent[] = [];
  const client = createMetaClient({
    accessToken: TOKEN,
    appSecret: SECRET,
    fetch: server.fetch,
    now: clock.now,
    sleep: clock.sleep,
    throttle: new Throttle({ now: clock.now, sleep: clock.sleep }),
    onUsage: (e) => void usage.push(e),
    log: (e) => void logs.push(e),
  });
  return { client, server, clock, usage, logs };
}

async function failure(p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    if (e instanceof MetaApiError) return e;
    throw e;
  }
  throw new Error("expected a MetaApiError");
}

describe("requests", () => {
  it("pin v26.0, send the token in a header and sign with appsecret_proof", async () => {
    const { client, server } = setup(fixture("success_status"));
    await client.get(`${ACT}/campaigns`, { fields: "id,name", limit: 200 });
    const [call] = server.calls;
    expect(call!.url.pathname).toBe(`/v26.0/${ACT}/campaigns`);
    expect(call!.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(call!.url.searchParams.get("appsecret_proof")).toBe(createHmac("sha256", SECRET).update(TOKEN).digest("hex"));
    expect(call!.url.searchParams.get("limit")).toBe("200");
    expect(call!.url.toString()).not.toContain(TOKEN);
  });

  it("form-encode POST bodies with objects as JSON", async () => {
    const { client, server } = setup(fixture("campaign_created"));
    const res = await client.post<{ id: string }>(`${ACT}/campaigns`, {
      name: "Lumen_US_2026-10-30",
      objective: "OUTCOME_SALES",
      special_ad_categories: [],
      status: "PAUSED",
    });
    expect(res.id).toBe("120200000000000123");
    const body = server.calls[0]!.body!;
    expect(body.get("special_ad_categories")).toBe("[]");
    expect(body.get("status")).toBe("PAUSED");
    expect(body.has("access_token")).toBe(false);
  });

  it("never put the token in log events", async () => {
    const { client, logs } = setup(fixture("success_status"), fixture("error_validation"));
    await client.get(`${ACT}/ads`);
    await failure(client.post("120200000000000123", { daily_budget: 50 }));
    expect(logs).toHaveLength(2);
    expect(JSON.stringify(logs)).not.toContain(TOKEN);
    expect(logs[1]).toMatchObject({ errorKind: "validation", errorCode: 100, status: 400 });
  });
});

describe("paging and endpoints", () => {
  it("follow cursors and merge owned and client ad accounts", async () => {
    const { client, server } = setup(
      fixture("owned_ad_accounts_page1"),
      fixture("owned_ad_accounts_page2"),
      fixture("client_ad_accounts"),
    );
    const accounts = await listBusinessAdAccounts(client, "100000000000001");
    expect(accounts.map((a) => a.id)).toEqual([
      "act_200000000000001",
      "act_200000000000002",
      "act_200000000000003",
      "act_200000000000009",
    ]);
    expect(server.calls[1]!.url.searchParams.get("after")).toBe("QVFIUnB3");
    expect(server.calls[2]!.url.pathname).toBe("/v26.0/100000000000001/client_ad_accounts");
  });

  it("report required permissions the token lacks", async () => {
    const { client } = setup(fixture("permissions"));
    expect(missingPermissions(await getTokenPermissions(client))).toEqual(["pages_manage_metadata"]);
  });

  it("reject budgets that are not whole minor units before calling Meta", () => {
    const { client, server } = setup();
    expect(() => setDailyBudget(client, "1", 12.5, ACT)).toThrow(MetaApiError);
    expect(server.calls).toHaveLength(0);
  });
});

describe("create guard", () => {
  it("refuses creates that are not paused, without calling Meta", async () => {
    const { client, server } = setup(fixture("campaign_created"));
    for (const edge of ["campaigns", "adsets", "ads"]) {
      const err = await failure(client.post(`${ACT}/${edge}`, { name: "x", status: "ACTIVE" }));
      expect(err.kind).toBe("guard");
    }
    expect((await failure(client.post(`${ACT}/ads`, { name: "x" }))).kind).toBe("guard");
    expect((await failure(client.post("120200000000000101/copies", { deep_copy: false }))).kind).toBe("guard");
    expect(server.calls).toHaveLength(0);
    await client.post(`${ACT}/campaigns`, { name: "x", status: "PAUSED" });
    expect(server.calls).toHaveLength(1);
  });

  it("checks every request inside a batch", async () => {
    const { client, server } = setup();
    const err = await failure(
      client.batch([
        { method: "POST", relativeUrl: `${ACT}/adcreatives`, params: { name: "c" }, name: "c1" },
        { method: "POST", relativeUrl: `${ACT}/ads`, params: { creative: { creative_id: "{result=c1:$.id}" } } },
      ]),
    );
    expect(err.kind).toBe("guard");
    expect(server.calls).toHaveLength(0);
  });
});

describe("error handling", () => {
  it("retries temporary errors twice, after 2 s then 8 s", async () => {
    const { client, clock, server } = setup(fixture("error_temporary"), fixture("error_temporary"), fixture("success_status"));
    await client.get(`${ACT}/ads`);
    expect(server.calls).toHaveLength(3);
    expect(clock.slept).toEqual([2_000, 8_000]);
  });

  it("gives up on temporary errors after the second retry", async () => {
    const { client, server } = setup(fixture("error_temporary"), fixture("error_temporary"), fixture("error_temporary"));
    const err = await failure(client.get(`${ACT}/ads`));
    expect(err.kind).toBe("temporary");
    expect(server.calls).toHaveLength(3);
  });

  it("backs off per the usage headers on a short rate limit, then succeeds", async () => {
    const { client, clock, server } = setup(fixture("error_rate_limit_short"), fixture("success_status"));
    await client.post("120200000000000123", { status: "PAUSED" }, { accountId: ACT });
    expect(server.calls).toHaveLength(2);
    expect(clock.slept).toEqual([20_000]);
  });

  it("hands long rate limits back to the queue with retryAfterMs", async () => {
    const { client, server, clock } = setup(fixture("error_rate_limit_long"));
    const err = await failure(client.get(`${ACT}/insights`));
    expect(err.kind).toBe("rate_limit");
    expect(err.retryAfterMs).toBe(12 * 60_000);
    expect(server.calls).toHaveLength(1);
    expect(clock.slept).toEqual([]);
    expect(describeMetaError(err).fix).toBe("Requests resume automatically in about 12 min.");
  });

  it("never retries more than 3 times", async () => {
    const { client, server } = setup(
      ...Array.from({ length: 5 }, () => fixture("error_rate_limit_short")),
    );
    const err = await failure(client.get(`${ACT}/ads`));
    expect(err.kind).toBe("rate_limit");
    expect(server.calls).toHaveLength(4);
  });

  it.each([
    ["error_validation", "validation", { stopsLaunch: false, alertsOwner: false }],
    ["error_token_expired", "auth", { stopsConnection: true, stopsLaunch: true, alertsOwner: true }],
    ["error_permission", "permission", { stopsConnection: false, stopsLaunch: true }],
    ["error_policy", "policy", { stopsLaunch: true, alertsOwner: true }],
  ] as const)("does not retry %s and classifies it as %s", async (name, kind, flags) => {
    const { client, server } = setup(fixture(name));
    const err = await failure(client.post("120200000000000123", { daily_budget: 50 }, { accountId: ACT }));
    expect(server.calls).toHaveLength(1);
    expect(err.kind).toBe(kind);
    expect(err).toMatchObject(flags);
  });

  it("keeps Meta's own wording for validation errors", async () => {
    const { client } = setup(fixture("error_validation"));
    const err = await failure(client.post("120200000000000123", { daily_budget: 50 }, { accountId: ACT }));
    expect(describeMetaError(err)).toMatchObject({
      title: "Budget too low",
      detail: "Your daily budget must be at least $1.00.",
    });
    expect(err.fbtraceId).toBe("A1b2C3valid");
  });

  it("does not retry a write that timed out, and marks it ambiguous", async () => {
    const timeout = new DOMException("The operation timed out.", "TimeoutError");
    const { client, server } = setup(timeout, fixture("success_status"));
    const err = await failure(client.post("120200000000000123", { status: "PAUSED" }, { accountId: ACT }));
    expect(err).toMatchObject({ kind: "timeout", ambiguous: true });
    expect(server.calls).toHaveLength(1);
  });

  it("retries a read after a dropped connection", async () => {
    const { client, server } = setup(new TypeError("fetch failed"), fixture("success_status"));
    await client.get(`${ACT}/ads`);
    expect(server.calls).toHaveLength(2);
  });
});

describe("usage", () => {
  it("reports every usage header with the account it belongs to", async () => {
    const { client, usage } = setup(fixture("success_status"));
    await client.get(`${ACT}/campaigns`);
    expect(usage).toHaveLength(1);
    expect(usage[0]).toMatchObject({ accountId: ACT, usage: { maxPct: 12.5, tier: "development_access" } });
  });

  it("pauses the account at 75% until Meta's reset time", async () => {
    const { client, clock, server } = setup(fixture("success_high_usage"), fixture("success_status"));
    await client.post("120200000000000123", { status: "PAUSED" }, { accountId: ACT });
    await client.get(`${ACT}/ads`);
    expect(server.calls).toHaveLength(2);
    expect(clock.slept).toEqual([10_000]);
  });

  it("keeps working when usage bookkeeping fails", async () => {
    const server = replay(fixture("success_status"));
    const client = createMetaClient({
      accessToken: TOKEN,
      appSecret: SECRET,
      fetch: server.fetch,
      onUsage: () => {
        throw new Error("database down");
      },
    });
    await expect(client.get(`${ACT}/ads`)).resolves.toEqual({ success: true });
  });
});

describe("batch", () => {
  it("sends one request and returns a result per item", async () => {
    const { client, server } = setup(fixture("batch_mixed"));
    const results = await client.batch<{ id: string }>([
      { method: "POST", relativeUrl: `${ACT}/adcreatives`, params: { name: "c1", object_story_id: "1_2" }, name: "c1" },
      { method: "POST", relativeUrl: `${ACT}/ads`, params: { name: "a1", creative: { creative_id: "{result=c1:$.id}" }, status: "PAUSED" } },
      { method: "GET", relativeUrl: "120200000000000777", params: { fields: "id,name" } },
    ]);
    expect(server.calls).toHaveLength(1);
    const sent = JSON.parse(server.calls[0]!.body!.get("batch")!);
    expect(sent[0]).toMatchObject({ method: "POST", name: "c1", relative_url: `${ACT}/adcreatives` });
    expect(new URLSearchParams(sent[1].body).get("creative")).toBe('{"creative_id":"{result=c1:$.id}"}');
    expect(sent[2].relative_url).toBe("120200000000000777?fields=id%2Cname");

    expect(results[0]).toEqual({ ok: true, body: { id: "120200000000000777" } });
    expect(results[1]!.ok).toBe(false);
    if (!results[1]!.ok) expect(describeMetaError(results[1]!.error).title).toBe("Missing link");
    expect(results[2]!.ok).toBe(false);
  });

  it("refuses more than 50 requests", async () => {
    const { client } = setup();
    const err = await failure(
      client.batch(Array.from({ length: 51 }, () => ({ method: "GET" as const, relativeUrl: "me" }))),
    );
    expect(err.kind).toBe("guard");
  });
});

describe("describeMetaError for blocked apps", () => {
  it("explains Meta's (#200) API access blocked as an app restriction", () => {
    const err = new MetaApiError({ kind: "permission", code: 200, message: "(#200) API access blocked." });
    expect(describeMetaError(err).title).toBe("Meta blocked API access for your app");
    const traced = new MetaApiError({ kind: "permission", code: 200, subcode: 1815694, fbtraceId: "AbC123", message: "(#200) API access blocked." });
    expect(describeMetaError(traced).detail).toContain("error 200/1815694, trace AbC123");
    expect(describeMetaError(new MetaApiError({ kind: "permission", code: 200, message: "(#200) Requires ads_management permission" })).title).toBe("Missing permission on Meta");
  });
});

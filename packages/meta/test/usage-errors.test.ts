import { describe, expect, it } from "vitest";
import { classifyCode, describeMetaError, errorFromGraph, parseUsage, pauseUntil, waitFromUsage } from "../src";
import { fixture } from "./replay";

describe("parseUsage", () => {
  it("reads all three usage headers", () => {
    const usage = parseUsage({
      "X-Ad-Account-Usage": '{"acc_id_util_pct": 9.67, "reset_time_duration": 0, "ads_api_access_tier": "standard_access"}',
      "X-Business-Use-Case-Usage": fixture("error_rate_limit_long").headers["x-business-use-case-usage"],
      "X-App-Usage": '{"call_count": 4, "total_cputime": 2, "total_time": 3}',
    });
    expect(usage).toMatchObject({
      adAccount: { utilPct: 9.67, resetSeconds: 0, tier: "standard_access" },
      business: [{ businessId: "100000000000001", type: "ads_management", callCount: 100, regainMinutes: 12 }],
      app: { callCount: 4 },
      maxPct: 100,
      tier: "standard_access",
    });
  });

  it("returns null without usage headers and survives malformed ones", () => {
    expect(parseUsage({})).toBeNull();
    expect(parseUsage({ "x-ad-account-usage": "not json" })).toBeNull();
  });
});

describe("pausing", () => {
  const now = 1_000;
  it("waits for the longer of the reset and regain times", () => {
    const usage = parseUsage({
      "x-ad-account-usage": '{"acc_id_util_pct": 80, "reset_time_duration": 30}',
      "x-business-use-case-usage": '{"1": [{"type": "ads_management", "call_count": 10, "estimated_time_to_regain_access": 2}]}',
    });
    expect(waitFromUsage(usage)).toBe(120_000);
    expect(pauseUntil(usage, now)).toBe(now + 120_000);
  });

  it("pauses a default minute when Meta gives no time", () => {
    expect(pauseUntil(parseUsage({ "x-app-usage": '{"call_count": 90}' }), now)).toBe(now + 60_000);
  });

  it("does not pause below 75%", () => {
    expect(pauseUntil(parseUsage({ "x-app-usage": '{"call_count": 74}' }), now)).toBeNull();
  });
});

describe("error map (docs/spec.md → Error handling)", () => {
  it.each([
    [4, "rate_limit"],
    [17, "rate_limit"],
    [613, "rate_limit"],
    [80000, "rate_limit"],
    [80014, "rate_limit"],
    [1, "temporary"],
    [2, "temporary"],
    [190, "auth"],
    [10, "permission"],
    [200, "permission"],
    [294, "permission"],
    [100, "validation"],
    [368, "policy"],
    [12345, "unknown"],
  ] as const)("code %i → %s", (code, kind) => {
    expect(classifyCode(code)).toBe(kind);
  });

  it("treats unknown transient errors and bare 5xx responses as temporary", () => {
    expect(classifyCode(999, true)).toBe("temporary");
    expect(errorFromGraph(undefined, 502).kind).toBe("temporary");
  });

  it("gives every error a title, a reason and a fix", () => {
    for (const name of ["error_validation", "error_token_expired", "error_permission", "error_policy", "error_temporary"]) {
      const f = fixture(name);
      const d = describeMetaError(errorFromGraph((f.body as { error: object }).error, f.status));
      expect(d.title.length).toBeGreaterThan(0);
      expect(d.detail.length).toBeGreaterThan(0);
      expect(d.fix.length).toBeGreaterThan(0);
    }
  });
});

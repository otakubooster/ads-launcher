import { describe, expect, it } from "vitest";
import { MetaApiError, Throttle, parseUsage } from "../src";
import { fakeClock } from "./replay";

const A = "act_1";
const B = "act_2";

function setup() {
  const clock = fakeClock(0);
  const throttle = new Throttle({ now: clock.now, sleep: clock.sleep });
  const starts: [string, number][] = [];
  const write = (id: string) => throttle.run(id, "write", async () => void starts.push([id, clock.now()]));
  return { clock, throttle, starts, write };
}

describe("Throttle", () => {
  it("runs writes to one account one at a time, at most 2 per second", async () => {
    const { starts, write } = setup();
    await Promise.all([write(A), write(A), write(A)]);
    expect(starts).toEqual([
      [A, 0],
      [A, 500],
      [A, 1000],
    ]);
  });

  it("does not hold one account's writes behind another's", async () => {
    const { starts, write } = setup();
    await Promise.all([write(A), write(B)]);
    expect(starts).toEqual([
      [A, 0],
      [B, 0],
    ]);
  });

  it("keeps the queue moving after a failed write", async () => {
    const { throttle, starts, write } = setup();
    const failing = throttle.run(A, "write", async () => {
      throw new Error("boom");
    });
    await expect(failing).rejects.toThrow("boom");
    await write(A);
    expect(starts).toEqual([[A, 500]]);
  });

  it("does not space reads", async () => {
    const { throttle, clock } = setup();
    await Promise.all([throttle.run(A, "read", async () => 1), throttle.run(A, "read", async () => 2)]);
    expect(clock.slept).toEqual([]);
  });

  it("pauses an account at 75% usage and resumes after Meta's reset", async () => {
    const { throttle, clock } = setup();
    throttle.record(A, parseUsage({ "x-ad-account-usage": '{"acc_id_util_pct": 74.9, "reset_time_duration": 9}' }));
    expect(throttle.pausedUntil(A)).toBeNull();
    throttle.record(A, parseUsage({ "x-ad-account-usage": '{"acc_id_util_pct": 75, "reset_time_duration": 9}' }));
    expect(throttle.pausedUntil(A)).toBe(9_000);
    expect(throttle.pausedUntil(B)).toBeNull();
    await throttle.run(A, "read", async () => {});
    expect(clock.slept).toEqual([9_000]);
    expect(throttle.pausedUntil(A)).toBeNull();
  });

  it("hands long pauses back to the caller instead of sleeping", async () => {
    const { throttle, clock } = setup();
    throttle.record(
      A,
      parseUsage({
        "x-business-use-case-usage":
          '{"1": [{"type": "ads_management", "call_count": 96, "total_cputime": 10, "total_time": 10, "estimated_time_to_regain_access": 7}]}',
      }),
    );
    const err = await throttle.run(A, "write", async () => {}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MetaApiError);
    expect(err).toMatchObject({ kind: "rate_limit", retryAfterMs: 7 * 60_000 });
    expect(clock.slept).toEqual([]);
  });
});

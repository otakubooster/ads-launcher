import { readFileSync } from "node:fs";

/** A response recorded in Meta's format: status, rate-limit headers and JSON body. */
export type Fixture = { status: number; headers: Record<string, string>; body: unknown };

export function fixture(name: string): Fixture {
  return JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8")) as Fixture;
}

export type RecordedCall = { method: string; url: URL; headers: Record<string, string>; body: URLSearchParams | null };

/** A fetch that replays fixtures in order (or throws a given error) and records each request. */
export function replay(...steps: (Fixture | Error)[]) {
  const queue = [...steps];
  const calls: RecordedCall[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({
      method: init?.method ?? "GET",
      url: new URL(String(input)),
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: init?.body ? new URLSearchParams(String(init.body)) : null,
    });
    const step = queue.shift();
    if (!step) throw new Error(`No fixture left for ${String(input)}`);
    if (step instanceof Error) throw step;
    return new Response(JSON.stringify(step.body), { status: step.status, headers: step.headers });
  }) as typeof fetch;
  return { fetch: fetchImpl, calls, remaining: () => queue.length };
}

/** Deterministic time: sleep advances the clock instead of waiting. */
export function fakeClock(start = 1_800_000_000_000) {
  const clock = {
    t: start,
    slept: [] as number[],
    now: () => clock.t,
    sleep: async (ms: number) => {
      clock.slept.push(ms);
      clock.t += ms;
    },
  };
  return clock;
}

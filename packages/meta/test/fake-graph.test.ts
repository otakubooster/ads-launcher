import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMetaClient, listBusinessAdAccounts, MetaApiError, setStatus } from "../src";
import { FAKE_BUSINESS_ID, createFakeGraph } from "../src/testing/fake-graph";

const fake = createFakeGraph();
let client: ReturnType<typeof createMetaClient>;

beforeAll(async () => {
  process.env.META_GRAPH_HOST = await fake.listen();
  client = createMetaClient({ accessToken: "EAAFAKEtoken-for-tests-000", appSecret: "s" });
});
afterAll(async () => {
  delete process.env.META_GRAPH_HOST;
  await fake.close();
});

describe("fake Graph server", () => {
  it("serves business assets", async () => {
    const accounts = await listBusinessAdAccounts(client, FAKE_BUSINESS_ID);
    expect(accounts.map((a) => a.name)).toEqual(["Lumen US", "Lumen UK", "Arbor FR"]);
  });

  it("creates paused objects in a batch with result references", async () => {
    const act = "act_200000000000001";
    const { data: adsets } = await client.get<{ data: { id: string }[] }>(`${act}/adsets`);
    const results = await client.batch<{ id: string }>([
      { method: "POST", relativeUrl: `${act}/adcreatives`, params: { name: "c1", object_story_spec: { page_id: "1" } }, name: "c1" },
      { method: "POST", relativeUrl: `${act}/ads`, params: { name: "a1", adset_id: adsets[0]!.id, creative: { creative_id: "{result=c1:$.id}" }, status: "PAUSED" } },
    ]);
    expect(results.every((r) => r.ok)).toBe(true);
    const adId = results[1]!.ok ? results[1]!.body.id : "";
    const ad = await client.get<{ status: string; creative: { id: string } }>(adId);
    expect(ad.status).toBe("PAUSED");
    await setStatus(client, adId, "ACTIVE", act);
    expect((await client.get<{ status: string }>(adId)).status).toBe("ACTIVE");
  });

  it("rejects tokens that are not fake tokens with code 190", async () => {
    const bad = createMetaClient({ accessToken: "EAArealLookingTokenButNotFake", appSecret: "s" });
    const err = await bad.get("me").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MetaApiError);
    expect((err as MetaApiError).kind).toBe("auth");
  });

  it("injects forced errors", async () => {
    await fetch(`${process.env.META_GRAPH_HOST}/__fake/fail`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ match: "^GET me$", error: { code: 100, message: "Forced", error_user_title: "Forced title", error_user_msg: "Forced message" } }),
    });
    const err = (await client.get("me").catch((e: unknown) => e)) as MetaApiError;
    expect(err.userTitle).toBe("Forced title");
    await expect(client.get("me")).resolves.toMatchObject({ name: "fahd-ads-launcher" });
  });
});

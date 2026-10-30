import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptToken, encryptToken } from "../src";

const KEY = randomBytes(32).toString("base64");
const TOKEN = "EAAGm0PX4ZCpsBAKZCZBtestsystemusertoken9f3a";

describe("token encryption", () => {
  it("round-trips and keeps only the last 4 in clear", () => {
    const enc = encryptToken(`  ${TOKEN}\n`, KEY);
    expect(enc.last4).toBe("9f3a");
    expect(enc.ciphertext).not.toContain(TOKEN.slice(0, 10));
    expect(decryptToken(enc.ciphertext, enc.iv, KEY)).toBe(TOKEN);
  });

  it("uses a fresh IV every time", () => {
    expect(encryptToken(TOKEN, KEY).ciphertext).not.toBe(encryptToken(TOKEN, KEY).ciphertext);
  });

  it("rejects tampering and the wrong key", () => {
    const enc = encryptToken(TOKEN, KEY);
    const tampered = Buffer.from(enc.ciphertext, "base64");
    tampered[0]! ^= 1;
    expect(() => decryptToken(tampered.toString("base64"), enc.iv, KEY)).toThrow();
    expect(() => decryptToken(enc.ciphertext, enc.iv, randomBytes(32).toString("base64"))).toThrow();
  });

  it("refuses bad keys and non-tokens", () => {
    expect(() => encryptToken(TOKEN, randomBytes(16).toString("base64"))).toThrow(/32 bytes/);
    expect(() => encryptToken("short", KEY)).toThrow(/access token/);
  });
});

import { describe, expect, it } from "vitest";
import { groupKey, pairCreatives, ratioOf, validateCreative } from "../src";

describe("ratioOf", () => {
  it("snaps within 2%", () => {
    expect(ratioOf(1080, 1920)).toBe("9:16");
    expect(ratioOf(1080, 1350)).toBe("4:5");
    expect(ratioOf(1080, 1080)).toBe("1:1");
    expect(ratioOf(1920, 1080)).toBe("16:9");
    expect(ratioOf(1080, 1900)).toBe("9:16");
    expect(ratioOf(1000, 1500)).toBeNull();
  });
});

describe("groupKey and pairing (week 3 check)", () => {
  it("strips extensions and ratio suffixes", () => {
    expect(groupKey("hook3_9x16.mp4")).toBe("hook3");
    expect(groupKey("hook3_4x5.mp4")).toBe("hook3");
    expect(groupKey("Hook3-Story.MOV")).toBe("hook3");
    expect(groupKey("summer sale feed.jpg")).toBe("summer sale");
    expect(groupKey("plain.png")).toBe("plain");
  });

  it("pairs name_9x16 and name_4x5 into one creative and flags unpaired files", () => {
    const files = ["hook3_9x16.mp4", "hook3_4x5.mp4", "hook4_9x16.mp4"].map((f, i) => ({
      fileName: f,
      groupKey: groupKey(f),
      ratio: (i === 1 ? "4:5" : "9:16") as "4:5" | "9:16",
    }));
    const groups = pairCreatives(files);
    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({ key: "hook3", ratios: ["9:16", "4:5"], paired: true });
    expect(groups[1]).toMatchObject({ key: "hook4", paired: false });
  });
});

describe("validateCreative", () => {
  it("flags ratio, resolution, length and size", () => {
    expect(validateCreative({ fileName: "a.mp4", kind: "video", width: 1080, height: 1920, durationS: 15, sizeBytes: 5e7 })).toEqual([]);
    const issues = validateCreative({ fileName: "a.mp4", kind: "video", width: 720, height: 1100, durationS: 120, sizeBytes: 5e9 });
    expect(issues.map((i) => i.level)).toEqual(["warning", "warning", "warning", "error"]);
    expect(validateCreative({ fileName: "a.jpg", kind: "image", width: 400, height: 500, sizeBytes: 31 * 1024 * 1024 }).filter((i) => i.level === "error")).toHaveLength(2);
  });
});

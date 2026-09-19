import { describe, expect, it } from "vitest";
import { charEditDistance, measureEdit } from "../../services/textDiff.js";

describe("transcript edit measurement", () => {
  it("reports no edit when the correction is identical", () => {
    expect(measureEdit("你好世界", "你好世界")).toEqual({ distance: 0, base: 4, ratio: 0 });
  });

  it("counts each changed Chinese character as one edit", () => {
    const { distance, base, ratio } = measureEdit("你好世界", "你好天界");

    expect(distance).toBe(1);
    expect(base).toBe(4);
    expect(ratio).toBeCloseTo(0.25);
  });

  it("ignores whitespace so reflowing a transcript is not an edit", () => {
    expect(charEditDistance("你好 世界", "你好世界")).toBe(0);
    expect(measureEdit("nǐ hǎo", "nǐhǎo").distance).toBe(0);
  });

  it("treats every character of the correction as an insertion when the original is empty", () => {
    const { distance, base, ratio } = measureEdit("", "你好");

    expect(distance).toBe(2);
    expect(base).toBe(0);
    // No length to divide by, so a non-empty correction reads as a complete
    // rewrite rather than a division by zero.
    expect(ratio).toBe(1);
  });

  it("reports a zero ratio when both sides are empty", () => {
    expect(measureEdit("", "")).toEqual({ distance: 0, base: 0, ratio: 0 });
  });

  it("counts a deletion as one edit per removed character", () => {
    expect(charEditDistance("你好世界", "你好")).toBe(2);
  });

  it("handles characters outside the basic multilingual plane as single units", () => {
    // 𠮷 is a surrogate pair - splitting on code units would double-count it.
    expect(charEditDistance("𠮷野家", "吉野家")).toBe(1);
  });
});

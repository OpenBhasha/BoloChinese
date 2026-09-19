import { describe, expect, it } from "vitest";
import { buildMeta, escapeRegex, MAX_LIMIT, parsePagination } from "../../services/pagination.js";

describe("pagination parsing", () => {
  it("falls back to the first page and the default limit when the query is empty", () => {
    expect(parsePagination({})).toEqual({ page: 1, limit: 20, skip: 0 });
  });

  it("skips the pages before the requested one", () => {
    expect(parsePagination({ page: "3", limit: "10" })).toEqual({ page: 3, limit: 10, skip: 20 });
  });

  it("clamps a limit above the maximum so one request cannot pull the whole collection", () => {
    expect(parsePagination({ limit: "5000" }).limit).toBe(MAX_LIMIT);
  });

  it("clamps a page below one back to the first page", () => {
    expect(parsePagination({ page: "0" }).page).toBe(1);
    expect(parsePagination({ page: "-4" }).page).toBe(1);
  });

  it("clamps a negative limit up to one rather than inverting the skip", () => {
    // A negative limit would otherwise produce a negative skip, which Mongo rejects.
    expect(parsePagination({ page: "3", limit: "-9" })).toEqual({ page: 3, limit: 1, skip: 2 });
  });

  it("treats a zero limit as unset and uses the default", () => {
    expect(parsePagination({ limit: "0" }).limit).toBe(20);
  });

  it("ignores a non-numeric page or limit", () => {
    expect(parsePagination({ page: "abc", limit: "many" })).toEqual({ page: 1, limit: 20, skip: 0 });
  });
});

describe("pagination metadata", () => {
  it("reports more pages remaining while the page is not the last", () => {
    expect(buildMeta(1, 20, 45)).toEqual({
      page: 1,
      limit: 20,
      total: 45,
      totalPages: 3,
      hasMore: true,
    });
  });

  it("reports no more pages on the final page", () => {
    expect(buildMeta(3, 20, 45).hasMore).toBe(false);
  });

  it("reports one page when the collection is empty, so clients never render zero pages", () => {
    expect(buildMeta(1, 20, 0)).toMatchObject({ totalPages: 1, hasMore: false });
  });
});

describe("search term escaping", () => {
  it("neutralises regex metacharacters in a user's search term", () => {
    const pattern = new RegExp(escapeRegex("a.b*c"));

    expect(pattern.test("a.b*c")).toBe(true);
    expect(pattern.test("axbxc")).toBe(false);
  });

  it("neutralises a term crafted to match everything", () => {
    expect(new RegExp(escapeRegex(".*")).test("anything")).toBe(false);
  });
});

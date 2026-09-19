import { describe, expect, it } from "vitest";
import { detectIdentityIssue } from "../../modules/register/services/register.service.js";

describe("anonymous identity detection", () => {
  it("accepts an ordinary full name", () => {
    expect(detectIdentityIssue({ name: "Li Wei" })).toMatchObject({ blocked: false, flagged: false });
  });

  it.each(["anon", "Anonymous", "test", "asdf", "qwerty", "N/A", "None"])(
    "rejects the placeholder name %j",
    (name) => {
      expect(detectIdentityIssue({ name })).toMatchObject({ blocked: true, flagged: true });
    }
  );

  it("rejects a name too short to be a name", () => {
    expect(detectIdentityIssue({ name: "Li" })).toMatchObject({
      blocked: true,
      reason: expect.stringContaining("too short"),
    });
  });

  it("rejects a name with no letters in it", () => {
    expect(detectIdentityIssue({ name: "123456" })).toMatchObject({
      blocked: true,
      reason: expect.stringContaining("no letters"),
    });
  });

  it("rejects a single character typed over and over", () => {
    expect(detectIdentityIssue({ name: "aaaaaa" })).toMatchObject({
      blocked: true,
      reason: expect.stringContaining("repeated character"),
    });
  });

  it("flags a short mononym for admin review rather than blocking it", () => {
    // Many cultures use mononyms, so this is a soft signal, not a rejection.
    expect(detectIdentityIssue({ name: "Wang" })).toMatchObject({ blocked: false, flagged: true });
  });

  it("accepts a longer mononym without flagging it", () => {
    expect(detectIdentityIssue({ name: "Ramanujan" })).toMatchObject({ blocked: false, flagged: false });
  });

  it("ignores surrounding whitespace when judging a name", () => {
    expect(detectIdentityIssue({ name: "   test   " })).toMatchObject({ blocked: true });
  });

  it("rejects a missing name instead of letting it through", () => {
    expect(detectIdentityIssue({})).toMatchObject({ blocked: true });
  });

  it("explains why it rejected a name, so the client can say something useful", () => {
    expect(detectIdentityIssue({ name: "anon" }).reason).not.toBe("");
  });
});

import { describe, expect, it } from "vitest";
import { kolkataDate } from "../../services/datetime.js";

// The daily batch is given, worked, backed up and wiped on an IST calendar
// day, so these boundaries decide which day a submission is filed under.
describe("Kolkata calendar day", () => {
  it("formats an instant as YYYY-MM-DD", () => {
    expect(kolkataDate(new Date("2026-09-10T06:30:00Z"))).toBe("2026-09-10");
  });

  it("still reports the previous day just before IST midnight", () => {
    // 18:29 UTC is 23:59 IST on the same date.
    expect(kolkataDate(new Date("2026-09-10T18:29:00Z"))).toBe("2026-09-10");
  });

  it("rolls over to the next day at IST midnight, not at UTC midnight", () => {
    expect(kolkataDate(new Date("2026-09-10T18:30:00Z"))).toBe("2026-09-11");
    // UTC has not rolled over yet - the whole reason the helper exists.
    expect(new Date("2026-09-10T18:30:00Z").toISOString().slice(0, 10)).toBe("2026-09-10");
  });

  it("reports the next day for a late-evening UTC instant", () => {
    expect(kolkataDate(new Date("2026-09-10T23:00:00Z"))).toBe("2026-09-11");
  });

  it("defaults to now when called without an instant", () => {
    expect(kolkataDate()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

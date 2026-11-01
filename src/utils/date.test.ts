import { describe, expect, it } from "vitest";
import { addDays } from "./date";

describe("addDays", () => {
  it("adds days within a month", () => {
    expect(addDays("2026-11-01", 1)).toBe("2026-11-02");
  });

  it("rolls over month and year ends", () => {
    expect(addDays("2026-11-30", 1)).toBe("2026-12-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("handles leap days", () => {
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2027-02-28", 1)).toBe("2027-03-01");
  });

  it("returns the same day for 0", () => {
    expect(addDays("2026-11-01", 0)).toBe("2026-11-01");
  });

  it("is not thrown off by a daylight-saving change", () => {
    expect(addDays("2026-03-28", 3)).toBe("2026-03-31");
    expect(addDays("2026-10-24", 3)).toBe("2026-10-27");
  });
});

import { describe, expect, it } from "vitest";
import { parseTimePart } from "./timePart";

describe("parseTimePart", () => {
  it("accepts a typed hour and pads it", () => {
    expect(parseTimePart("7", 23)).toBe("07");
    expect(parseTimePart("19", 23)).toBe("19");
  });

  it("accepts a typed minute", () => {
    expect(parseTimePart("7", 59)).toBe("07");
    expect(parseTimePart("59", 59)).toBe("59");
  });

  it("rejects values above the maximum", () => {
    expect(parseTimePart("24", 23)).toBeNull();
    expect(parseTimePart("60", 59)).toBeNull();
  });

  it("rejects empty, negative, decimal and non-numeric input", () => {
    for (const bad of ["", " ", "-1", "1.5", "ab", "1a", "١٢"]) expect(parseTimePart(bad, 59)).toBeNull();
  });

  it("trims whitespace", () => {
    expect(parseTimePart(" 5 ", 59)).toBe("05");
  });
});

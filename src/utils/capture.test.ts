import { describe, expect, it } from "vitest";
import { parseCapture } from "./capture";

describe("parseCapture", () => {
  it("treats plain text as a task", () => {
    expect(parseCapture("buy milk")).toEqual({ kind: "task", title: "buy milk" });
  });

  it("treats an 'n:' prefix as a note", () => {
    expect(parseCapture("n: idea")).toEqual({ kind: "note", title: "idea" });
  });

  it("accepts the prefix without a space and in upper case", () => {
    expect(parseCapture("N:idea")).toEqual({ kind: "note", title: "idea" });
  });

  it("trims surrounding whitespace", () => {
    expect(parseCapture("  call mom  ")).toEqual({ kind: "task", title: "call mom" });
  });

  it("returns null for blank input", () => {
    expect(parseCapture("  ")).toBeNull();
    expect(parseCapture("")).toBeNull();
  });

  it("returns null for a note prefix with nothing after it", () => {
    expect(parseCapture("n:")).toBeNull();
    expect(parseCapture("n:   ")).toBeNull();
  });

  it("does not treat a word that merely starts with n as a note", () => {
    expect(parseCapture("nap time")).toEqual({ kind: "task", title: "nap time" });
  });
});

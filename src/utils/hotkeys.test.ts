import { describe, expect, it } from "vitest";
import { matchHotkey } from "./hotkeys";

const ev = (over: Partial<Parameters<typeof matchHotkey>[0]>) => ({
  key: "", ctrlKey: false, shiftKey: false, altKey: false, ...over,
});

describe("matchHotkey", () => {
  it("matches Ctrl+N on a ctrl+n keydown", () => {
    expect(matchHotkey(ev({ key: "n", ctrlKey: true }), "Ctrl+N")).toBe(true);
  });

  it("is case-insensitive for the key (Caps Lock / Shift state)", () => {
    expect(matchHotkey(ev({ key: "N", ctrlKey: true }), "ctrl+n")).toBe(true);
  });

  it("does not match when an extra modifier is held", () => {
    expect(matchHotkey(ev({ key: "n", ctrlKey: true, shiftKey: true }), "Ctrl+N")).toBe(false);
    expect(matchHotkey(ev({ key: "n", ctrlKey: true, altKey: true }), "Ctrl+N")).toBe(false);
  });

  it("does not match without the required modifier", () => {
    expect(matchHotkey(ev({ key: "n" }), "Ctrl+N")).toBe(false);
  });

  it("does not match a different key", () => {
    expect(matchHotkey(ev({ key: "f", ctrlKey: true }), "Ctrl+N")).toBe(false);
  });

  it("supports Shift and Alt in the spec", () => {
    expect(matchHotkey(ev({ key: "k", ctrlKey: true, shiftKey: true }), "Ctrl+Shift+K")).toBe(true);
    expect(matchHotkey(ev({ key: "k", altKey: true }), "Alt+K")).toBe(true);
  });
});

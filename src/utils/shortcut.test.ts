import { describe, expect, it } from "vitest";
import { acceleratorFromEvent, prettyShortcut } from "./shortcut";

const ev = (over: Partial<Parameters<typeof acceleratorFromEvent>[0]>) => ({
  code: "",
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  metaKey: false,
  ...over,
});

describe("acceleratorFromEvent", () => {
  it("builds Control+Alt+G from Ctrl+Alt+KeyG", () => {
    const r = acceleratorFromEvent(ev({ code: "KeyG", ctrlKey: true, altKey: true }));
    expect(r.acc).toBe("Control+Alt+G");
    expect(r.error).toBeUndefined();
  });

  it("rejects a key with no modifier", () => {
    const r = acceleratorFromEvent(ev({ code: "KeyG" }));
    expect(r.acc).toBeUndefined();
    expect(r.error).toMatch(/modifier/i);
  });

  it("returns only a preview while just a modifier is held", () => {
    const r = acceleratorFromEvent(ev({ code: "ControlLeft", ctrlKey: true }));
    expect(r.acc).toBeUndefined();
    expect(r.error).toBeUndefined();
    expect(r.preview).toBe("Ctrl + …");
  });
});

describe("prettyShortcut", () => {
  it("shows Control as Ctrl with spaced plus signs", () => {
    expect(prettyShortcut("Control+Alt+G")).toBe("Ctrl + Alt + G");
  });
});

import { describe, expect, it } from "vitest";
import { linkEndingAtCaret } from "./linkCaret";

/** <p>before <a href="https://x.dev">link</a> after</p> */
function fixture() {
  const p = document.createElement("p");
  p.innerHTML = 'before <a href="https://x.dev">link</a> after';
  const a = p.querySelector("a")!;
  return { p, a, linkText: a.firstChild as Text, before: p.firstChild as Text, after: p.lastChild as Text };
}

const caret = (node: Node, offset: number) => {
  const r = document.createRange();
  r.setStart(node, offset);
  r.collapse(true);
  return r;
};

describe("linkEndingAtCaret", () => {
  it("returns the link when the caret is at the end of its text", () => {
    const f = fixture();
    expect(linkEndingAtCaret(caret(f.linkText, 4))).toBe(f.a);
  });

  it("returns the link when the caret sits at the end of the link element itself", () => {
    const f = fixture();
    expect(linkEndingAtCaret(caret(f.a, 1))).toBe(f.a);
  });

  it("is null in the middle of a link", () => {
    const f = fixture();
    expect(linkEndingAtCaret(caret(f.linkText, 2))).toBeNull();
  });

  it("is null at the start of a link", () => {
    const f = fixture();
    expect(linkEndingAtCaret(caret(f.linkText, 0))).toBeNull();
  });

  it("is null outside any link", () => {
    const f = fixture();
    expect(linkEndingAtCaret(caret(f.after, 3))).toBeNull();
    expect(linkEndingAtCaret(caret(f.before, 6))).toBeNull();
  });

  it("is null for a selection that is not collapsed", () => {
    const f = fixture();
    const r = document.createRange();
    r.setStart(f.linkText, 1);
    r.setEnd(f.linkText, 4);
    expect(linkEndingAtCaret(r)).toBeNull();
  });

  it("handles formatting nested inside the link (<a><b>text</b></a>)", () => {
    const p = document.createElement("p");
    p.innerHTML = '<a href="https://x.dev"><b>bold</b></a>';
    const text = p.querySelector("b")!.firstChild as Text;
    expect(linkEndingAtCaret(caret(text, 4))).toBe(p.querySelector("a"));
  });

  it("is null when the caret is at the end of text that is NOT the link's last content", () => {
    const p = document.createElement("p");
    p.innerHTML = '<a href="https://x.dev"><b>bold</b> more</a>';
    const text = p.querySelector("b")!.firstChild as Text;
    expect(linkEndingAtCaret(caret(text, 4))).toBeNull();
  });
});

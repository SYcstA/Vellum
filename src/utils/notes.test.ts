import { describe, expect, it } from "vitest";
import { noteContentToHtml, stripHtml } from "./notes";

describe("noteContentToHtml", () => {
  it("turns newlines in legacy plain text into <br>", () => {
    expect(noteContentToHtml("a\nb")).toBe("a<br>b");
  });

  it("escapes HTML-significant characters in plain text", () => {
    expect(noteContentToHtml("1 < 2 & 3")).toBe("1 &lt; 2 &amp; 3");
  });

  it("passes real HTML through untouched", () => {
    expect(noteContentToHtml("<p>a</p>")).toBe("<p>a</p>");
  });

  it("returns empty string for empty content", () => {
    expect(noteContentToHtml("")).toBe("");
  });
});

describe("stripHtml", () => {
  it("removes tags and decodes entities", () => {
    expect(stripHtml("<p>a&amp;b</p>")).toBe("a&b");
  });

  it("collapses whitespace between blocks", () => {
    expect(stripHtml("<p>a</p><p>b&nbsp;c</p>")).toBe("a b c");
  });
});

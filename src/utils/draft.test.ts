import { beforeEach, describe, expect, it } from "vitest";
import { clearDraft, loadDraft, saveDraft } from "./draft";

const KEY = "vellum_note_draft";

beforeEach(() => localStorage.clear());

describe("note draft storage", () => {
  it("round-trips a draft", () => {
    saveDraft({ title: "Ideas", content: "<p>hi</p>" });
    expect(loadDraft()).toEqual({ title: "Ideas", content: "<p>hi</p>" });
  });

  it("returns null when nothing is saved", () => {
    expect(loadDraft()).toBeNull();
  });

  it("returns null for corrupt JSON", () => {
    localStorage.setItem(KEY, "{not json");
    expect(loadDraft()).toBeNull();
  });

  it("returns null when the stored value has the wrong shape", () => {
    localStorage.setItem(KEY, JSON.stringify({ title: 5 }));
    expect(loadDraft()).toBeNull();
  });

  it("removes the key when both fields are blank", () => {
    saveDraft({ title: "x", content: "y" });
    saveDraft({ title: "  ", content: "" });
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("clearDraft removes the key", () => {
    saveDraft({ title: "x", content: "" });
    clearDraft();
    expect(localStorage.getItem(KEY)).toBeNull();
  });
});

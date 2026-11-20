import { describe, expect, it } from "vitest";
import { keyedSingleFlight } from "./singleFlight";

/** A run whose completion the test controls. */
function controlled() {
  const calls: string[] = [];
  const releases: Array<() => void> = [];
  const run = (key: string) => {
    calls.push(key);
    return new Promise<void>((resolve) => releases.push(resolve));
  };
  return { calls, releases, run };
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

describe("keyedSingleFlight", () => {
  it("shares one run between overlapping calls with the same key", async () => {
    const c = controlled();
    const go = keyedSingleFlight(c.run);
    const a = go("09:00");
    const b = go("09:00");
    await tick();
    expect(c.calls).toEqual(["09:00"]);
    c.releases[0]();
    await Promise.all([a, b]);
    expect(c.calls).toEqual(["09:00"]);
  });

  it("runs again with the new key after the current run, never in parallel", async () => {
    const c = controlled();
    const go = keyedSingleFlight(c.run);
    const a = go("09:00");
    const b = go("09:30");
    await tick();
    expect(c.calls).toEqual(["09:00"]); // second waits for the first
    c.releases[0]();
    await a;
    await tick();
    expect(c.calls).toEqual(["09:00", "09:30"]);
    c.releases[1]();
    await b;
  });

  it("starts a fresh run once the previous one has finished", async () => {
    const c = controlled();
    const go = keyedSingleFlight(c.run);
    const a = go("09:00");
    await tick();
    c.releases[0]();
    await a;
    await tick();
    void go("09:00");
    await tick();
    expect(c.calls).toEqual(["09:00", "09:00"]);
  });

  it("keeps going after a run rejects", async () => {
    const calls: string[] = [];
    const go = keyedSingleFlight(async (key: string) => {
      calls.push(key);
      if (key === "bad") throw new Error("boom");
    });
    await expect(go("bad")).rejects.toThrow("boom");
    await go("good");
    expect(calls).toEqual(["bad", "good"]);
  });
});

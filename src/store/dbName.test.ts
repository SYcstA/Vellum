import { describe, expect, it } from "vitest";
import { dbUrl } from "./dbName";

describe("dbUrl", () => {
  it("uses the real database in a production build", () => {
    expect(dbUrl(false)).toBe("sqlite:productivity.db");
  });

  it("uses a separate database file in dev so it never touches the installed app's data", () => {
    expect(dbUrl(true)).toBe("sqlite:productivity-dev.db");
  });
});

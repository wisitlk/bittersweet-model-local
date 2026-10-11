import { describe, expect, it } from "vitest";
import { truncate } from "../src/text";

describe("truncate", () => {
  it("leaves short strings alone", () => {
    expect(truncate("abc", 5)).toBe("abc");
  });

  it("cuts to the limit", () => {
    expect(truncate("abcdef", 3)).toBe("abc");
  });

  it("never splits a surrogate pair", () => {
    const s = "ab😀cd"; // the emoji is two UTF-16 units at index 2 and 3
    expect(truncate(s, 3)).toBe("ab");
    expect(truncate(s, 4)).toBe("ab😀");
    expect(truncate(s, 3)).not.toMatch(/[\ud800-\udbff]$/);
  });
});

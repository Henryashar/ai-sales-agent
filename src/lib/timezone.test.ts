import { describe, expect, it } from "vitest";

import { getTimezoneFromPhone } from "./timezone";

describe("getTimezoneFromPhone", () => {
  it.each([
    ["(206) 555-0100", "Pacific"],
    ["303 555 0100", "Mountain"],
    ["312-555-0100", "Central"],
    ["212.555.0100", "Eastern"],
  ])("maps %s to %s", (phone, expected) => {
    expect(getTimezoneFromPhone(phone)).toBe(expected);
  });

  it("returns Unknown for an unmapped area code", () => {
    expect(getTimezoneFromPhone("(999) 555-0100")).toBe("Unknown");
  });
});

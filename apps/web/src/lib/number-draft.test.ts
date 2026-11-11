import { describe, expect, it } from "vitest";
import { readNumberDraft } from "@/lib/number-draft";

const minutes = {
  min: 1,
  max: 1440,
  integer: true,
  message: "Enter a whole number of minutes from 1 to 1440.",
};

describe("reading a number field's text", () => {
  it("reads what was typed, without a leading zero or an old digit", () => {
    expect(readNumberDraft("5", minutes)).toEqual({ ok: true, value: 5 });
    expect(readNumberDraft("030", minutes)).toEqual({ ok: true, value: 30 });
  });

  it("refuses empty text instead of reading it as 0", () => {
    expect(readNumberDraft("", minutes)).toEqual({
      ok: false,
      error: minutes.message,
    });
  });

  it("refuses values out of range or not whole, instead of clamping them", () => {
    expect(readNumberDraft("0", minutes).ok).toBe(false);
    expect(readNumberDraft("1441", minutes).ok).toBe(false);
    expect(readNumberDraft("2.5", minutes).ok).toBe(false);
    expect(readNumberDraft("abc", minutes).ok).toBe(false);
  });

  it("takes a decimal comma where decimals are allowed", () => {
    expect(readNumberDraft("2,5", { message: "Enter a number." })).toEqual({
      ok: true,
      value: 2.5,
    });
  });
});

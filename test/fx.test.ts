import { describe, expect, it } from "vitest";
import { APPLICATION_FEE_USD } from "../src/config/constants.js";
import { toLocal, usdToKobo } from "../src/config/fx.js";

describe("FX conversion", () => {
  it("converts the $25 application fee to exactly 3,321,700 kobo", () => {
    expect(toLocal(APPLICATION_FEE_USD, "NGN")).toBe(33_217);
    expect(usdToKobo(APPLICATION_FEE_USD)).toBe(3_321_700);
  });

  it("converts $275 to ₦365,385", () => {
    expect(toLocal(275, "NGN")).toBe(365_385);
  });
});

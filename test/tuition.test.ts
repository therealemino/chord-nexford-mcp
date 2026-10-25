import { describe, expect, it } from "vitest";
import { quoteTuition } from "../src/lib/tuition.js";

describe("quoteTuition", () => {
  it("Nigeria MBA: $275/month, ₦365,385, with 9 and 18 month examples", () => {
    expect(quoteTuition("MBA", "Nigeria")).toEqual({
      available: true,
      programme: "MBA",
      country: "Nigeria",
      usd: 275,
      billing_unit: "per_month",
      local: { currency: "NGN", amount: 365_385 },
      examples: [
        { months: 9, usd: 2475, local: { currency: "NGN", amount: 3_288_461 } },
        { months: 18, usd: 4950, local: { currency: "NGN", amount: 6_576_921 } },
      ],
    });
  });

  it("Nigeria BBA: $120 per course", () => {
    const q = quoteTuition("BBA", "nigeria");
    expect(q).toMatchObject({ available: true, usd: 120, billing_unit: "per_course", local: { currency: "NGN", amount: 159_441 } });
  });

  it("Ghana MBA is not published", () => {
    expect(quoteTuition("MBA", "Ghana")).toEqual({ available: false, programme: "MBA", country: "Ghana", reason: "not_published" });
  });

  it("US MS Data Analytics: $470/month, no local currency", () => {
    const q = quoteTuition("MS Data Analytics", "USA");
    expect(q).toMatchObject({ available: true, usd: 470, billing_unit: "per_month", country: "United States" });
    expect(q.available && q.local).toBeUndefined();
  });

  it("US-only programmes are not quoted for Nigeria", () => {
    expect(quoteTuition("MS Data Analytics", "Nigeria").available).toBe(false);
  });

  it("Saudi Arabia MBA is USD only", () => {
    expect(quoteTuition("MBA", "Saudi Arabia")).toMatchObject({ available: true, usd: 320, local: undefined });
  });
});

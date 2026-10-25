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

  it("Nigeria + Fintech and Blockchain is priced as the MBA and keeps the specialisation name", () => {
    expect(quoteTuition("MBA in Fintech and Blockchain", "Nigeria")).toEqual({
      available: true,
      programme: "MBA with a Fintech and Blockchain specialisation",
      specialisation: "Fintech and Blockchain",
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

  it("Kenya + AI is priced as the Kenya MBA", () => {
    expect(quoteTuition("MBA with an AI specialization", "Kenya")).toEqual({
      available: true,
      programme: "MBA with an AI specialisation",
      specialisation: "AI",
      country: "Kenya",
      usd: 300,
      billing_unit: "per_month",
      local: { currency: "KES", amount: 38_895 },
      examples: [
        { months: 9, usd: 2700, local: { currency: "KES", amount: 350_055 } },
        { months: 18, usd: 5400, local: { currency: "KES", amount: 700_110 } },
      ],
    });
  });

  it("recognises every published specialisation", () => {
    for (const [input, spec] of [
      ["MBA AI", "AI"],
      ["MBA in Cybersecurity", "Cybersecurity"],
      ["MBA Enabling E-Commerce", "Enabling E-Commerce"],
      ["MBA in Fintech & Blockchain", "Fintech and Blockchain"],
      ["MBA in International Business", "International Business"],
      ["MBA Sustainability", "Sustainability"],
      ["MBA in Healthcare Management", "Healthcare Management"],
    ]) {
      expect(quoteTuition(input, "Nigeria")).toMatchObject({ available: true, usd: 275, specialisation: spec });
    }
  });

  it("MBA in Finance and MBA in Entrepreneurship are not specialisations", () => {
    expect(quoteTuition("MBA in Finance", "Nigeria").available).toBe(false);
    expect(quoteTuition("MBA in Finance", "United States")).toMatchObject({ available: true, usd: 470 });
    expect(quoteTuition("MBA in Entrepreneurship", "Nigeria").available).toBe(false);
    expect(quoteTuition("MBA in Entrepreneurship", "United States").available).toBe(false);
  });

  it("an MBA variant that isn't a published specialisation is not priced", () => {
    expect(quoteTuition("MBA in Marketing", "Nigeria")).toMatchObject({ available: false, reason: "unknown_programme" });
  });

  it("Saudi Arabia MBA is USD only", () => {
    expect(quoteTuition("MBA", "Saudi Arabia")).toMatchObject({ available: true, usd: 320, local: undefined });
  });
});

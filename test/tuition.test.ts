import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";
import { findCountry } from "../src/config/countries.js";
import { resolveProgramme } from "../src/config/programmes.js";
import { quoteTuition, type TuitionPrice } from "../src/lib/tuition.js";
import { callTool } from "../src/mcp/server.js";
import { makeDeps } from "./helpers/fakes.js";

const NOW = DateTime.fromISO("2026-10-26T10:00:00Z");
const price = (programme: string, country: string, now = NOW) => {
  const q = quoteTuition(programme, country, now);
  if (!q.available) throw new Error(`expected a price for ${programme} / ${country}, got ${q.reason}`);
  return q as TuitionPrice;
};

describe("tier prices", () => {
  it("Nigeria + MS in Digital Transformation: $280, ₦372,028, 12 courses, tier 4, with both totals", () => {
    const q = price("MS in Digital Transformation", "Nigeria");
    expect(q).toMatchObject({
      programme: "MS in Digital Transformation",
      specialisation: null,
      country: "Nigeria",
      tier: 4,
      billing: "per_month",
      price_usd: 280,
      price_local: { currency: "NGN", amount: 372_028, formatted: "₦372,028" },
      estimates: {
        fastest_months: 9, fastest_total_usd: 2520, fastest_total_local: "₦3,348,251",
        slowest_months: 18, slowest_total_usd: 5040, slowest_total_local: "₦6,696,502",
      },
      programme_facts: { courses: 12, structure: "11 core courses and a capstone", length: "9 to 18 months" },
      application_fee: { usd: 25, local: "₦33,217", refundable: false },
    });
  });

  it("MSDA and msai in Nigeria: $280; MS AI has 13 courses", () => {
    expect(price("MSDA", "Nigeria").price_usd).toBe(280);
    const ai = price("msai", "Nigeria");
    expect(ai).toMatchObject({ price_usd: 280, programme: "MS in AI and Technology Management", programme_facts: { courses: 13 } });
  });

  it("Nigeria + MBA Fintech & Blockchain: $275 with the specialisation", () => {
    expect(price("MBA Fintech & Blockchain", "Nigeria")).toMatchObject({
      price_usd: 275,
      programme: "MBA in Fintech and Blockchain",
      specialisation: "Fintech and Blockchain",
      programme_facts: { courses: 12 },
    });
  });

  it("Nigeria + MBA Finance: $280, not $275, and no totals (no published range)", () => {
    const q = price("MBA Finance", "Nigeria");
    expect(q).toMatchObject({ price_usd: 280, programme: "MBA in Finance", specialisation: null, programme_facts: { length: "10 months at the fastest pace" } });
    expect(q.estimates).toBeUndefined();
  });

  it("Kenya + MBA in AI: $300 and a KES amount; Kenya + BBA: $140 per course, no totals", () => {
    expect(price("MBA in AI", "Kenya")).toMatchObject({ price_usd: 300, specialisation: "AI", price_local: { currency: "KES", amount: 38_895 } });
    const bba = price("BBA", "Kenya");
    expect(bba).toMatchObject({ price_usd: 140, billing: "per_course" });
    expect(bba.estimates).toBeUndefined();
    expect(bba.notes).toContain("Tuition is paid per course; transfer credit can reduce the number of courses.");
  });

  it("Ghana + BBA: $120 per course, GH₵1,404; Ghana + BS in AI for Business: $130", () => {
    expect(price("BBA", "Ghana")).toMatchObject({ price_usd: 120, price_local: { currency: "GHS", amount: 1404, formatted: "GH₵1,404" } });
    expect(price("BS in AI for Business", "Ghana").price_usd).toBe(130);
  });

  it("USA, US and United States + MBA: $450 with no local currency", () => {
    for (const c of ["USA", "US", "United States", "u.s.a.", "America"]) {
      expect(price("MBA", c)).toMatchObject({ country: "United States", tier: 1, price_usd: 450, price_local: null });
    }
    expect(price("MBA", "USA").estimates).toEqual({ fastest_months: 9, fastest_total_usd: 4050, slowest_months: 18, slowest_total_usd: 8100 });
  });

  it("UK + MS Data Analytics: $470; Saudi Arabia + BBA: $230", () => {
    expect(price("MS Data Analytics", "UK").price_usd).toBe(470);
    expect(price("BBA", "Saudi Arabia")).toMatchObject({ tier: 2, price_usd: 230 });
  });

  it("covers every pricing family at tier 4", () => {
    const cases: [string, number][] = [
      ["MBA in Entrepreneurship", 275], ["Mini-MBA certificate", 275], ["AAS in Business", 120], ["AAS in AI for Business", 130],
      ["BAS in Management and AI in Business", 145], ["single graduate course", 215], ["single undergraduate course", 120],
    ];
    for (const [p, usd] of cases) expect(price(p, "NG").price_usd).toBe(usd);
  });
});

describe("unavailable answers", () => {
  it("South Africa + MBA: unknown_country with the calculator link, despite a ZAR rate", () => {
    expect(quoteTuition("MBA", "South Africa", NOW)).toEqual({
      available: false, reason: "unknown_country", programme: "MBA", country: "South Africa", calculator_url: "https://www.nexford.edu/tuition",
    });
  });

  it("AI alone is ambiguous with four candidates", () => {
    expect(quoteTuition("AI", "Nigeria", NOW)).toMatchObject({
      available: false,
      reason: "ambiguous_programme",
      candidates: ["MBA in AI", "MS in AI and Technology Management", "BS in AI for Business", "AAS in AI for Business"],
    });
    for (const p of ["master's", "bachelor's", "MS"]) expect(quoteTuition(p, "Nigeria", NOW)).toMatchObject({ reason: "ambiguous_programme" });
  });

  it("Undergraduate Career Pathways and pathway programmes are not offered via the lookup", () => {
    expect(quoteTuition("Undergraduate Career Pathways", "Nigeria", NOW)).toMatchObject({ available: false, reason: "not_offered_via_tool" });
    expect(quoteTuition("Capella pathway", "Nigeria", NOW)).toMatchObject({ reason: "not_offered_via_tool" });
  });

  it("an unknown programme lists the known ones", () => {
    const q = quoteTuition("PhD in Astrophysics", "Nigeria", NOW);
    expect(q).toMatchObject({ available: false, reason: "unknown_programme" });
    expect(q.available === false && q.reason === "unknown_programme" && q.known_programmes).toContain("MS in Digital Transformation");
  });
});

describe("aliases", () => {
  it.each([
    ["Master of Business Administration", "MBA"], ["masters in business", "MBA"], ["MBA in Artificial Intelligence", "MBA in AI"],
    ["MBA Cybersecurity", "MBA in Cybersecurity"], ["MBA E-Commerce", "MBA in Enabling E-Commerce"], ["Fintech & Blockchain MBA", "MBA in Fintech and Blockchain"],
    ["MBA Healthcare", "MBA in Healthcare Management"], ["MBAE", "MBA in Entrepreneurship"], ["MBAF", "MBA in Finance"],
    ["MS AI", "MS in AI and Technology Management"], ["MSc AI", "MS in AI and Technology Management"], ["AI & Tech Management", "MS in AI and Technology Management"],
    ["Data Analytics masters", "MS in Data Analytics"], ["MSc Data Analytics", "MS in Data Analytics"], ["MSDT", "MS in Digital Transformation"],
    ["Mini MBA", "Mini-MBA"], ["Bachelor of Business Administration", "BBA"], ["BBA in Digital Marketing", "BBA in Digital Marketing"],
    ["Associate in Business", "AAS in Business"], ["BSAIB", "BS in AI for Business"], ["Bachelor in AI for Business", "BS in AI for Business"],
    ["AASAIB", "AAS in AI for Business"], ["Associate in AI", "AAS in AI for Business"], ["three-year bachelor's", "BAS in Management and AI in Business"],
    ["BASMAIB", "BAS in Management and AI in Business"], ["an online MBA degree programme", "MBA"],
  ])("%s → %s", (input, name) => {
    const m = resolveProgramme(input);
    expect(m.kind === "match" && m.programme.name).toBe(name);
  });

  it.each([
    ["Nigeria", "Nigeria"], ["NGA", "Nigeria"], ["naija", "Nigeria"], ["  ng ", "Nigeria"], ["Britain", "United Kingdom"], ["GB", "United Kingdom"],
    ["Scotland", "United Kingdom"], ["Türkiye", "Turkey"], ["KSA", "Saudi Arabia"], ["Saudi", "Saudi Arabia"], ["EGY", "Egypt"], ["The Philippines", "Philippines"],
  ])("country %s → %s", (input, name) => {
    expect(findCountry(input)?.name).toBe(name);
  });
});

describe("rounding and notes", () => {
  it("every local amount is a whole number", () => {
    for (const [p, c] of [["MBA", "Nigeria"], ["BBA", "Ghana"], ["MSDA", "Kenya"], ["BAS", "Egypt"]] as const) {
      const q = price(p, c);
      expect(Number.isInteger(q.price_local!.amount)).toBe(true);
    }
  });

  it("the new payment model note appears only from 1 December 2026, Lagos time", () => {
    const has = (iso: string) => price("MBA", "Nigeria", DateTime.fromISO(iso)).notes.some((n) => n.includes("1 January 2027"));
    expect(has("2026-11-30T22:59:00Z")).toBe(false); // 23:59 Lagos, 30 Nov
    expect(has("2026-11-30T23:00:00Z")).toBe(true); // 00:00 Lagos, 1 Dec
  });
});

describe("get_tuition guidance", () => {
  const cases: [string, string][] = [
    ["MS in Digital Transformation", "Nigeria"], ["MBA Fintech & Blockchain", "Nigeria"], ["MBA Finance", "Nigeria"], ["BBA", "Kenya"],
    ["MBA", "USA"], ["MBA", "South Africa"], ["AI", "Nigeria"], ["Undergraduate Career Pathways", "Nigeria"], ["PhD", "Nigeria"],
  ];

  it("never contains asterisks, hashes, or the words tool, tier or playbook", async () => {
    const { deps } = makeDeps();
    for (const [programme, country] of cases) {
      const out = await callTool("get_tuition", { programme, country }, deps);
      expect(out.agent_guidance, `${programme} / ${country}`).not.toMatch(/[*#]|\btools?\b|\btiers?\b|playbook/i);
    }
  });

  it("monthly, specialisation, Finance and per-course wording", async () => {
    const { deps } = makeDeps();
    const g = async (programme: string, country: string) => String((await callTool("get_tuition", { programme, country }, deps)).agent_guidance);
    expect(await g("MS in Digital Transformation", "Nigeria")).toMatch(
      /^Quote \$280 a month and, for Nigeria, ₦372,028 at Nexford's current rate\. Mention that finishing faster costs less because the fee is monthly, and give the 9-month and 18-month totals only if they ask about total cost\./,
    );
    expect(await g("MBA Fintech & Blockchain", "Nigeria")).toContain("Say the Fintech and Blockchain specialisation costs the same as the standard MBA.");
    expect(await g("MBA Finance", "Nigeria")).toContain("includes up to seven CFI certifications at no extra cost");
    expect(await g("BBA", "Ghana")).toMatch(/^Quote \$120 per course \(GH₵1,404 at Nexford's current rate\)\. Explain that undergraduate tuition is paid per course/);
    expect(await g("MBA", "South Africa")).toMatch(/^Say you don't have the rate for South Africa confirmed here, share nexford\.edu\/tuition/);
  });

  it("saves the programme and country when contact_id is given, and never fails if saving fails", async () => {
    const { deps, db } = makeDeps();
    await callTool("get_tuition", { programme: "msda", country: "naija", contact_id: "c1" }, deps);
    expect(db.leads[0]).toMatchObject({ programme: "MS in Data Analytics", country: "Nigeria" });

    deps.repo.upsertLead = async () => {
      throw new Error("db down");
    };
    expect(await callTool("get_tuition", { programme: "MBA", country: "Ghana", contact_id: "c2" }, deps)).toMatchObject({ ok: true, price_usd: 275 });
  });
});

describe("price literals", () => {
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? files(join(dir, f)) : f.endsWith(".ts") ? [join(dir, f)] : []));

  it("live only in src/config/tuition.ts", () => {
    const rates = /\b(1328\.671|11\.704|129\.65|51\.941|16\.428|163\.143|1475\.916|2642\.661|3919\.872|578\.258)\b/;
    const money = /[$₦]\s?\d|GH₵\s?\d|\b(usd|price|tuition|fee)\w*\s*[:=]\s*\[?\d/i;
    const offenders = files("src")
      .filter((f) => !f.endsWith(join("config", "tuition.ts")))
      .flatMap((f) =>
        readFileSync(f, "utf8")
          .split("\n")
          .map((line, i) => ({ f, i: i + 1, line }))
          .filter(({ line }) => !/^\s*(\/\/|\*|\/\*\*)/.test(line) && (rates.test(line) || money.test(line))),
      );
    expect(offenders.map(({ f, i, line }) => `${f}:${i}: ${line.trim()}`)).toEqual([]);
  });
});

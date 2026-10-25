import { describe, expect, it } from "vitest";
import type { DegreeField } from "../src/config/foundation.js";
import { assessEligibility } from "../src/lib/eligibility.js";

const codes = (programme: string, degree_field: DegreeField, has_statistics_course?: boolean, years = 0) => {
  const a = assessEligibility({ programme, has_bachelors_degree: true, degree_field, has_statistics_course, years_relevant_experience: years });
  return { result: a.result, codes: a.foundation_courses.map((c) => c.code) };
};

describe("foundation table", () => {
  it("MBA: non-business degree needs FND 5100; business enters directly", () => {
    expect(codes("MBA", "other")).toEqual({ result: "foundation_likely", codes: ["FND 5100"] });
    expect(codes("MBA", "technology")).toEqual({ result: "foundation_likely", codes: ["FND 5100"] });
    expect(codes("MBA", "economics")).toEqual({ result: "direct_entry", codes: [] });
  });

  it("MBA specialisations follow the MBA rule", () => {
    expect(codes("MBA in Cybersecurity", "other")).toEqual({ result: "foundation_likely", codes: ["FND 5100"] });
    expect(codes("MBA with a Fintech and Blockchain specialisation", "business")).toEqual({ result: "direct_entry", codes: [] });
  });

  it("MBA in Finance: not business, finance or accounting needs FND 5100", () => {
    expect(codes("MBA in Finance", "technology")).toEqual({ result: "foundation_likely", codes: ["FND 5100"] });
    for (const f of ["business", "finance", "accounting"] as const) {
      expect(codes("MBA in Finance", f)).toEqual({ result: "direct_entry", codes: [] });
    }
  });

  it("MS AI and Technology Management: not business or technology needs FDT 5001", () => {
    expect(codes("MS AI and Technology Management", "other")).toEqual({ result: "foundation_likely", codes: ["FDT 5001"] });
    expect(codes("MS AI and Technology Management", "technology").result).toBe("direct_entry");
    expect(codes("MS AI and Technology Management", "business").result).toBe("direct_entry");
  });

  it("MS Data Analytics: all four background/statistics combinations", () => {
    expect(codes("MS Data Analytics", "other", false)).toEqual({ result: "foundation_likely", codes: ["FND 5100", "STA 1300"] });
    expect(codes("MS Data Analytics", "business", false)).toEqual({ result: "foundation_likely", codes: ["STA 1300"] });
    expect(codes("MS Data Analytics", "other", true)).toEqual({ result: "foundation_likely", codes: ["FND 5100"] });
    expect(codes("MS Data Analytics", "finance", true)).toEqual({ result: "direct_entry", codes: [] });
  });

  it("MS Digital Transformation: not IT or business needs FDT 5001", () => {
    expect(codes("MS Digital Transformation", "other")).toEqual({ result: "foundation_likely", codes: ["FDT 5001"] });
    expect(codes("MS Digital Transformation", "technology").result).toBe("direct_entry");
    expect(codes("MS Digital Transformation", "accounting").result).toBe("direct_entry");
  });
});

describe("eligibility edge cases", () => {
  it("waiver can be requested at 3 years, not at 2", () => {
    const at = (years: number) =>
      assessEligibility({ programme: "MBA", has_bachelors_degree: true, degree_field: "other", years_relevant_experience: years })
        .waiver_can_be_requested;
    expect(at(2)).toBe(false);
    expect(at(3)).toBe(true);
  });

  it("no waiver flag on direct entry", () => {
    const a = assessEligibility({ programme: "MBA", has_bachelors_degree: true, degree_field: "business", years_relevant_experience: 10 });
    expect(a.waiver_can_be_requested).toBe(false);
  });

  it("master's without a bachelor's degree is not_eligible", () => {
    expect(assessEligibility({ programme: "MBA", has_bachelors_degree: false }).result).toBe("not_eligible");
  });

  it("BBA and unrecognised programmes go to advisor_review", () => {
    expect(assessEligibility({ programme: "BBA", has_bachelors_degree: false }).result).toBe("advisor_review");
    expect(assessEligibility({ programme: "Mini-MBA" }).result).toBe("advisor_review");
    expect(assessEligibility({ programme: "PhD in Astrophysics" }).result).toBe("advisor_review");
  });

  it("MBA in Entrepreneurship has no published foundation rule, so it goes to advisor_review", () => {
    expect(codes("MBA in Entrepreneurship", "other").result).toBe("advisor_review");
  });

  it("MS Data Analytics without the statistics answer needs more info", () => {
    const a = assessEligibility({ programme: "MS Data Analytics", has_bachelors_degree: true, degree_field: "business" });
    expect(a.result).toBe("need_more_info");
    expect(a.missing_fields).toEqual(["has_statistics_course"]);
  });

  it("lists every missing field for a master's", () => {
    expect(assessEligibility({ programme: "MBA" }).missing_fields).toEqual(["has_bachelors_degree", "degree_field"]);
  });
});

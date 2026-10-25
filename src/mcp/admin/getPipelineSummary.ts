import { z } from "zod";
import { PERIODS, periodRange, summarisePipeline } from "../../lib/pipeline.js";
import { ok } from "../../lib/result.js";
import { defineTool } from "../types.js";

export const getPipelineSummary = defineTool({
  name: "get_pipeline_summary",
  description: [
    "Admissions pipeline numbers for a period (boundaries in Lagos time): new leads, qualified (assessed and not",
    "ineligible), paid (applicants whose application fee was paid in the period), conversion (paid / new leads),",
    "new leads by programme, foundation-likely share, plus current pending handoffs and overdue callbacks.",
  ].join(" "),
  shape: { period: z.enum(PERIODS).describe("today, yesterday, last_7_days (today + previous 6) or last_30_days.") },
  async handler({ period }, { repo, now }) {
    const { from, to, label } = periodRange(period, now());
    const [leads, payments, pending] = await Promise.all([
      repo.leadsCreatedBetween(from.toUTC().toISO()!, to.toUTC().toISO()!),
      repo.paymentsPaidBetween(from.toUTC().toISO()!, to.toUTC().toISO()!),
      repo.handoffsByStatus(["pending"], 1000),
    ]);
    return ok(
      { period: label, ...summarisePipeline(leads, payments, pending, now()) },
      "Report these numbers as given. Conversion is paid applicants in the period divided by new leads in the period, so it can exceed 100% on quiet days.",
    );
  },
});

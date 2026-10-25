import { ADVISOR_BOOKING_LINK, TUITION_CALCULATOR_LINK } from "../../config/constants.js";
import { FX_EFFECTIVE_DATE } from "../../config/fx.js";
import { ok } from "../../lib/result.js";
import { quoteTuition } from "../../lib/tuition.js";
import { countryField, programmeField } from "../shared.js";
import { defineTool } from "../types.js";

export const getTuition = defineTool({
  name: "get_tuition",
  description: [
    "Look up Nexford's published tuition for a programme in the person's country. Call it whenever they ask about cost, fees or tuition.",
    "Pass MBA specialisations with their name (e.g. \"MBA in Fintech and Blockchain\"); they are priced as the standard MBA.",
    "Returns the USD price, the billing unit (per_month or per_course) and, where Nexford publishes a rate, the local-currency amount.",
    "If available is false, there is no published price: never estimate or quote a number from elsewhere.",
  ].join(" "),
  shape: { programme: programmeField, country: countryField },
  async handler({ programme, country }) {
    const q = quoteTuition(programme, country);
    if (!q.available) {
      return ok(
        { available: false, programme: q.programme, country: q.country, tuition_calculator: TUITION_CALCULATOR_LINK, advisor_booking_link: ADVISOR_BOOKING_LINK },
        "There's no published price for this programme and country. Do not estimate. Share the tuition calculator link and offer to connect them with an Application Specialist.",
      );
    }
    const unit = q.billing_unit === "per_month" ? "a month" : "per course";
    return ok(
      { ...q, ...(q.local && { fx_rate_effective: FX_EFFECTIVE_DATE }) },
      `Say: the ${q.programme} is $${q.usd} ${unit}` +
        (q.local ? `, about ${q.local.currency} ${q.local.amount.toLocaleString("en-US")} at Nexford's current rate` : "") +
        ". Use only these numbers. " +
        (q.specialisation ? "Specialisations cost the same as the standard MBA. " : "") +
        (q.examples ? "You may mention the 9 and 18 month totals as examples; actual duration depends on their pace. " : "") +
        "Don't mention discounts or scholarships unless they ask; if they do, offer an Application Specialist.",
    );
  },
});

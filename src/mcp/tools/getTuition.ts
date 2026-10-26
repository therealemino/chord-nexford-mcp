import { z } from "zod";
import { ADVISOR_BOOKING_LINK } from "../../config/constants.js";
import { formatUsd } from "../../config/fx.js";
import { log } from "../../lib/log.js";
import { ok } from "../../lib/result.js";
import { quoteTuition, type TuitionPrice, type TuitionUnavailable } from "../../lib/tuition.js";
import { contactId, countryField, programmeField } from "../shared.js";
import { defineTool } from "../types.js";

/** How the agent should say the price. Written the way it should sound on WhatsApp; never names internal concepts. */
function priceGuidance(q: TuitionPrice): string {
  const price = formatUsd(q.price_usd);
  const parts: string[] = [];
  if (q.billing === "per_month") {
    parts.push(
      `Quote ${price} a month${q.price_local ? ` and, for ${q.country}, ${q.price_local.formatted} at Nexford's current rate` : ""}.`,
      "Mention that finishing faster costs less because the fee is monthly" +
        (q.estimates
          ? `, and give the ${q.estimates.fastest_months}-month and ${q.estimates.slowest_months}-month totals only if they ask about total cost.`
          : "."),
    );
  } else {
    parts.push(
      `Quote ${price} per course${q.price_local ? ` (${q.price_local.formatted} at Nexford's current rate)` : ""}.`,
      q.programme_id.startsWith("single_")
        ? "Explain that this is the price of one course taken on its own, outside a degree."
        : "Explain that undergraduate tuition is paid per course, and that transfer credit can reduce the number of courses.",
    );
  }
  if (q.specialisation) {
    const base = q.programme_id === "bba" ? "BBA" : "MBA";
    parts.push(`Say the ${q.specialisation} specialisation costs the same as the standard ${base}.`);
  }
  if (q.programme_id === "mba_finance") {
    parts.push("Say it costs a little more than the standard MBA and includes up to seven CFI certifications at no extra cost.");
  }
  parts.push("Use only these numbers and don't explain how countries are grouped for pricing.");
  return parts.join(" ");
}

function unavailableGuidance(q: TuitionUnavailable): string {
  switch (q.reason) {
    case "unknown_country":
      return `Say you don't have the rate for ${q.country} confirmed here, share nexford.edu/tuition, and offer an Application Specialist. Don't guess a price.`;
    case "ambiguous_programme":
      return "Ask which programme they mean, listing the candidates in plain words.";
    case "unknown_programme":
      return "Say you're not sure which programme they mean and list the closest options.";
    case "not_offered_via_tool":
      return "Say this is priced separately, share nexford.edu/tuition, and offer an Application Specialist. Don't guess a price.";
  }
}

export const getTuition = defineTool({
  name: "get_tuition",
  description: [
    "Returns Nexford's published tuition for a programme in a country: price in USD and local currency, billing basis, length and course count.",
    "Call this for any fee question once you know the programme and country.",
    'Pass the programme as the person said it, including any specialisation (e.g. "MBA in Fintech and Blockchain", "MSDA").',
    "If available is false, never estimate a price: follow agent_guidance (ask which programme, or offer an Application Specialist).",
    "Pass contact_id when you have it so the programme and country are saved.",
  ].join(" "),
  shape: {
    programme: programmeField,
    country: countryField,
    contact_id: contactId.nullish().describe("Optional. If given, the recognised programme and country are saved to the lead."),
  },
  async handler({ programme, country, contact_id }, { repo, now }) {
    const q = quoteTuition(programme, country, now());

    if (contact_id && q.available) {
      try {
        await repo.upsertLead(contact_id, { programme: q.programme, country: q.country });
      } catch (err) {
        log.warn("get_tuition could not save lead", { error: (err as Error).message });
      }
    }

    if (!q.available) {
      const handover = q.reason === "unknown_country" || q.reason === "not_offered_via_tool";
      return ok({ ...q, ...(handover && { advisor_booking_link: ADVISOR_BOOKING_LINK }) }, unavailableGuidance(q));
    }
    const { programme_id: _id, ...response } = q;
    return ok(response, priceGuidance(q));
  },
});

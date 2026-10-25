/**
 * One-time Chord setup for human alerts. Every call is REAL (Chord has no sandbox). Safe to rerun.
 *
 *   pnpm chord:setup-alerts [--notify-to <email>] [--owner <user_id>]
 *
 * 1. Chord's own escalation email: PUT escalation-notifications for CHORD_TEAMMATE_ID, so a real agent-to-human
 *    take-over emails the transcript and a dashboard link (notify_to = first ALERT_EMAIL_TO address by default).
 * 2. Backup keyword rules (RAISE_TAKEOVER) attached to the WhatsApp teammate, so "speak to a human" / "call me"
 *    reach a person even if the agent forgets handoff_to_advisor. Rules that already exist (by name) are reused.
 *    As of 25 Oct 2026 Chord rejects new rules with ESCALATION_RULES_DEPRECATED ("create an escalation trigger
 *    instead"); no trigger endpoint was found in the API, so the script prints what to set up by hand.
 */
import "dotenv/config";
import { parseArgs } from "node:util";
import { getPath } from "../src/config/chord.js";
import { ChordError, createChordClient } from "../src/services/chord.js";

const { values } = parseArgs({ options: { "notify-to": { type: "string" }, owner: { type: "string" } } });

const missing = ["CHORD_API_KEY", "CHORD_WORKSPACE_ID", "CHORD_TEAMMATE_ID"].filter((k) => !process.env[k]);
const notifyTo = values["notify-to"] ?? process.env.ALERT_EMAIL_TO?.split(",")[0]?.trim();
if (missing.length || !notifyTo) {
  console.error(`Set ${[...missing, ...(notifyTo ? [] : ["ALERT_EMAIL_TO (or pass --notify-to)"])].join(", ")}.`);
  process.exit(1);
}
const workspace_id = process.env.CHORD_WORKSPACE_ID!;
const teammateId = process.env.CHORD_TEAMMATE_ID!;
const owner_id = values.owner ?? process.env.CHORD_OWNER_ID;
const chord = createChordClient(process.env.CHORD_API_KEY!);

const RULES = [
  { name: "Human callback requested", condition_value: "speak to a human" },
  { name: "Human callback requested (call me)", condition_value: "call me" },
];

const show = (label: string, v: unknown) => console.log(`\n=== ${label} ===\n${JSON.stringify(v, null, 2)}`);
const errorInfo = (err: unknown) => (err instanceof ChordError ? { status: err.status, body: err.body } : { error: (err as Error).message });
let failures = 0;

async function step<T>(label: string, fn: () => Promise<T>): Promise<T | null> {
  try {
    const out = await fn();
    show(label, out);
    return out;
  } catch (err) {
    failures++;
    show(`${label} FAILED`, errorInfo(err));
    return null;
  }
}

await step(`escalation-notifications -> ${notifyTo}`, () =>
  chord.setEscalationNotifications(teammateId, { notify_to: notifyTo, workspace_id }),
);

const listed = await step("existing escalation rules", () => chord.listEscalationRules({ workspace_id }));
const existing = (["rules", "escalation_rules", "data", "items"].map((p) => getPath(listed, p)).find(Array.isArray) ??
  (Array.isArray(listed) ? listed : [])) as Record<string, unknown>[];

const ids: Record<string, string> = {};
let deprecated = false;
for (const rule of RULES) {
  if (deprecated) break;
  let ruleId = existing.find((r) => r.name === rule.name)?.id as string | undefined;
  if (ruleId) {
    console.log(`\nRule "${rule.name}" already exists: ${ruleId}`);
  } else {
    const created = await chord.createEscalationRule({
        name: rule.name,
        action: "RAISE_TAKEOVER",
        condition_type: "KEYWORD",
        condition_value: rule.condition_value,
        enabled: true,
        priority: 1,
        workspace_id,
        ...(owner_id && { owner_id }),
      }).catch((err) => {
        if (err instanceof ChordError && getPath(err.body, "error.code") === "ESCALATION_RULES_DEPRECATED") {
          deprecated = true;
          return null;
        }
        failures++;
        show(`create rule "${rule.name}" FAILED`, errorInfo(err));
        return null;
      });
    if (created) show(`create rule "${rule.name}"`, created);
    ruleId = getPath(created, "id") as string | undefined;
  }
  if (!ruleId) continue;
  ids[rule.name] = ruleId;
  const attached = await chord.attachEscalationRule(ruleId, teammateId).then(
    (r) => r,
    (err) => (err instanceof ChordError && err.status === 409 ? "already attached" : Promise.reject(err)),
  ).catch((err) => {
    failures++;
    return { failed: errorInfo(err) };
  });
  show(`attach "${rule.name}" to ${teammateId}`, attached);
}

if (deprecated) {
  console.log(
    "\nKeyword rules: Chord has deprecated escalation rules (ESCALATION_RULES_DEPRECATED) in favour of plain-text\n" +
      "escalation triggers, which this API doesn't expose. Add the backup trigger in the Chord dashboard instead, on the\n" +
      'WhatsApp teammate, e.g.: "Escalate to a human when the customer asks to speak to a human or asks us to call them."',
  );
} else {
  console.log(`\nRule ids: ${JSON.stringify(ids)}`);
}
console.log(failures ? `\n${failures} step(s) failed; see above.` : "\nDone.");
process.exit(failures ? 1 : 0);

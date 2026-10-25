/**
 * Minimal structured logger. Only pass identifiers and statuses (reference, lead_id, status, event):
 * never emails, phone numbers, names, card details or raw payloads.
 */
type Fields = Record<string, string | number | boolean | null | undefined>;

const write = (level: string, msg: string, fields: Fields = {}) =>
  console.log(JSON.stringify({ level, msg, ...fields, ts: new Date().toISOString() }));

export const log = {
  info: (msg: string, fields?: Fields) => write("info", msg, fields),
  warn: (msg: string, fields?: Fields) => write("warn", msg, fields),
  error: (msg: string, fields?: Fields) => write("error", msg, fields),
};

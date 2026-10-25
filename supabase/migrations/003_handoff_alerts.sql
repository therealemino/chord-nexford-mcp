-- Human alerts for every handoff: email (Resend) and a Chord dashboard action (flag or take-over).
alter table handoffs
  add column alert_emailed_at timestamptz,
  add column alert_error text,
  add column chord_flagged_at timestamptz,
  add column chord_flag_error text;

-- For the alerts health check (failures in the last 7 days).
create index handoffs_created_idx on handoffs (created_at);

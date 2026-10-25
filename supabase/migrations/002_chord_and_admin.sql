-- Chord thread linking, proactive payment confirmation, new-applicant handoffs and admin tooling.
-- handoffs.reason has no enum constraint (see 001), so 'new_applicant' is already allowed.

alter table leads add column chord_thread_id text;

alter table payments
  add column customer_notified_at timestamptz,
  add column notify_error text;

alter table handoffs
  add column notes text,
  add column contacted_at timestamptz,
  add column closed_at timestamptz,
  -- Set only for reason = 'new_applicant'; unique so each payment creates at most one such handoff.
  add column payment_id uuid references payments(id);

create unique index handoffs_payment_id_key on handoffs (payment_id);
create index handoffs_status_created_idx on handoffs (status, created_at);
create index leads_created_idx on leads (created_at);

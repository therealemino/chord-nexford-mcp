-- Nexford admissions prototype: leads, payments, handoffs, webhook log.
-- The server uses the service role key; RLS is on with no policies, so anon/authenticated clients see nothing.

create extension if not exists pgcrypto;

create or replace function set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table leads (
  id uuid primary key default gen_random_uuid(),
  contact_id text unique not null,
  whatsapp_number text,
  full_name text,
  email text,
  country text,
  programme text,
  has_bachelors_degree boolean,
  degree_field text check (degree_field in ('business', 'finance', 'accounting', 'economics', 'technology', 'other')),
  has_statistics_course boolean,
  years_relevant_experience integer check (years_relevant_experience between 0 and 60),
  eligibility_result text check (eligibility_result in ('direct_entry', 'foundation_likely', 'advisor_review', 'not_eligible')),
  foundation_courses text[],
  status text not null default 'enquiring' check (status in ('enquiring', 'qualified', 'applied', 'paid', 'handed_off')),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create trigger leads_set_updated_at before update on leads
  for each row execute function set_updated_at();

create table payments (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references leads(id),
  paystack_reference text unique not null,
  purpose text not null check (purpose in ('application_fee')),
  amount_kobo integer not null check (amount_kobo > 0),
  currency text not null default 'NGN',
  status text not null default 'pending' check (status in ('pending', 'success', 'failed', 'abandoned')),
  authorization_url text,
  paid_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index payments_lead_created_idx on payments (lead_id, created_at desc);

create trigger payments_set_updated_at before update on payments
  for each row execute function set_updated_at();

create table handoffs (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references leads(id),
  reason text not null,
  summary text not null,
  channel text not null check (channel in ('whatsapp', 'call')),
  callback_number text,
  callback_time timestamptz, -- agreed callback time, stored in UTC
  status text not null default 'pending' check (status in ('pending', 'contacted', 'closed')),
  created_at timestamptz default now()
);

create index handoffs_lead_idx on handoffs (lead_id);

create table webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'paystack',
  event text not null,
  reference text,
  payload jsonb not null,
  received_at timestamptz default now()
);

create index webhook_events_reference_idx on webhook_events (reference);

alter table leads enable row level security;
alter table payments enable row level security;
alter table handoffs enable row level security;
alter table webhook_events enable row level security;

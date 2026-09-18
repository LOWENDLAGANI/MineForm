-- ============================================================================
-- MineForm core migration
-- Dynamic relational schema: forms -> questions -> responses -> answers
-- Strict RLS: form owners get full CRUD; the public role gets INSERT-only
-- access to responses/answers, and only on published, non-locked forms.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Enums (TEXT + CHECK so new types ship without migrations downtime)
-- ---------------------------------------------------------------------------
create table public.forms (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 300),
  description text,
  slug text unique not null,
  time_limit_minutes int check (time_limit_minutes > 0),
  response_cap int check (response_cap > 0),
  theme_config jsonb not null default '{}'::jsonb,
  payment_config jsonb not null default '{}'::jsonb,
  is_published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.questions (
  id uuid primary key default gen_random_uuid(),
  form_id uuid not null references public.forms (id) on delete cascade,
  question_text text not null check (char_length(question_text) between 1 and 5000),
  question_type text not null default 'short_text' check (
    question_type in (
      'short_text', 'long_text', 'single_choice', 'multi_choice',
      'dropdown', 'rating', 'date', 'number', 'email', 'file_upload', 'payment'
    )
  ),
  options jsonb not null default '[]'::jsonb,
  validation_rules jsonb not null default '{}'::jsonb,
  logic_rules jsonb not null default '[]'::jsonb,
  is_required boolean not null default false,
  order_index int not null,
  unique (form_id, order_index)
);

create table public.responses (
  id uuid primary key default gen_random_uuid(),
  form_id uuid not null references public.forms (id) on delete cascade,
  started_at timestamptz not null default now(),
  submitted_at timestamptz,
  expires_at timestamptz,
  respondent_meta jsonb not null default '{}'::jsonb
);

create table public.answers (
  id uuid primary key default gen_random_uuid(),
  response_id uuid not null references public.responses (id) on delete cascade,
  question_id uuid not null references public.questions (id) on delete cascade,
  answer_text text,
  answer_json jsonb,
  created_at timestamptz not null default now(),
  -- exactly one of the two value columns must be populated
  constraint answers_value_check check (
    (answer_text is not null) <> (answer_json is not null)
  )
);

-- Cross-table integrity (question must belong to the response's form) cannot
-- be a CHECK constraint (no subqueries) — enforced by trigger instead.
create or replace function public.enforce_answers_same_form()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1
    from public.responses r
    join public.questions q on q.id = new.question_id
    where r.id = new.response_id and q.form_id = r.form_id
  ) then
    raise exception 'ANSWER_FORM_MISMATCH';
  end if;
  return new;
end;
$$;

create trigger answers_same_form
  before insert or update of question_id, response_id on public.answers
  for each row execute function public.enforce_answers_same_form();

-- Payments
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  response_id uuid not null references public.responses (id) on delete cascade,
  provider text not null check (provider in ('stripe', 'billplz')),
  provider_ref text unique,          -- checkout session / bill id
  amount_cents bigint not null check (amount_cents >= 0),
  currency char(3) not null,
  status text not null default 'pending' check (
    status in ('pending', 'succeeded', 'failed', 'refunded')
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.webhook_events (
  id text primary key,               -- Stripe event id / Billplz X-Signature event uid
  provider text not null check (provider in ('stripe', 'billplz')),
  payload jsonb not null,
  processed_at timestamptz,
  created_at timestamptz not null default now()
);

-- Indexes
create index questions_form_idx on public.questions (form_id, order_index);
create index responses_form_idx on public.responses (form_id, submitted_at desc);
create index responses_open_idx on public.responses (form_id)
  where submitted_at is null;
create index answers_response_idx on public.answers (response_id);
create index answers_question_idx on public.answers (question_id);
create index payments_response_idx on public.payments (response_id);
create index forms_user_idx on public.forms (user_id, created_at desc);

-- updated_at touch trigger
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger forms_touch_updated_at
  before update on public.forms
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Helper: does the calling user own the given form?
-- (stable so RLS planners can inline it per-row without caching side effects)
-- ---------------------------------------------------------------------------
create or replace function public.is_form_owner(fid uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.forms f
    where f.id = fid and f.user_id = auth.uid()
  );
$$;

-- ---------------------------------------------------------------------------
-- Response gate enforcement
-- A response may be created/submitted only when:
--   1. the parent form is published
--   2. the response cap (if set) has not been reached
--   3. the response is not expired (timer enforced server-side)
-- ---------------------------------------------------------------------------
create or replace function public.enforce_response_gates()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  f public.forms;
  current_count bigint;
begin
  select * into f from public.forms where id = new.form_id;
  if not found then
    raise exception 'FORM_NOT_FOUND';
  end if;

  if not f.is_published then
    raise exception 'FORM_NOT_PUBLISHED';
  end if;

  -- Response cap (row counts, not counters — no drift)
  if f.response_cap is not null and new.submitted_at is not null then
    select count(*) into current_count
    from public.responses r
    where r.form_id = new.form_id
      and r.submitted_at is not null
      and (tg_op = 'INSERT' or r.id <> new.id);

    if current_count >= f.response_cap then
      raise exception 'RESPONSE_CAP_REACHED';
    end if;
  end if;

  -- Quiz timer: server-side expiry only. Client clocks are never trusted.
  if new.expires_at is not null and now() > new.expires_at then
    if new.submitted_at is not null then
      raise exception 'RESPONSE_EXPIRED';
    end if;
    -- expired, unsubmitted responses are still allowed to persist as "abandoned"
  end if;

  return new;
end;
$$;

create trigger responses_enforce_gates
  before insert or update of submitted_at, expires_at on public.responses
  for each row execute function public.enforce_response_gates();

-- Auto-stamp expires_at at insert time (server clock, never client-supplied)
create or replace function public.set_expires_at()
returns trigger language plpgsql as $$
declare
  ttl int;
begin
  select time_limit_minutes into ttl
  from public.forms where id = new.form_id;

  if ttl is not null and new.expires_at is null then
    new.expires_at := now() + (ttl * interval '1 minute');
  end if;

  return new;
end;
$$;

create trigger responses_set_expires_at
  before insert on public.responses
  for each row execute function public.set_expires_at();

-- Payment gate: a response can only be submitted if its payment is settled
-- (applies only to forms that require payment)
create or replace function public.enforce_payment_gate()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  requires_payment boolean;
  settled boolean;
begin
  select (payment_config ->> 'required')::boolean into requires_payment
  from public.forms where id = new.form_id;

  if coalesce(requires_payment, false) then
    select exists (
      select 1 from public.payments p
      where p.response_id = new.id and p.status = 'succeeded'
    ) into settled;

    if not settled then
      raise exception 'PAYMENT_REQUIRED';
    end if;
  end if;

  return new;
end;
$$;

create trigger responses_enforce_payment_gate
  before update of submitted_at on public.responses
  for each row when (new.submitted_at is not null and old.submitted_at is null)
  execute function public.enforce_payment_gate();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.forms         enable row level security;
alter table public.questions     enable row level security;
alter table public.responses     enable row level security;
alter table public.answers       enable row level security;
alter table public.payments      enable row level security;
alter table public.webhook_events enable row level security;

-- forms: owner full control; published forms are world-readable
create policy "forms_owner_all" on public.forms
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "forms_public_read_published" on public.forms
  for select to anon, authenticated
  using (is_published = true);

-- questions: owner full control; world-readable iff parent form is published
create policy "questions_owner_all" on public.questions
  for all to authenticated
  using (public.is_form_owner(form_id))
  with check (public.is_form_owner(form_id));

create policy "questions_public_read" on public.questions
  for select to anon, authenticated
  using (
    exists (
      select 1 from public.forms f
      where f.id = form_id and f.is_published = true
    )
  );

-- responses: OWNER read/update/delete. Public gets INSERT only.
-- The INSERT policy additionally re-checks gates so an anon user cannot
-- even create an unsubmitted row against an unpublished/capped form.
create policy "responses_owner_select" on public.responses
  for select to authenticated
  using (public.is_form_owner(form_id));

create policy "responses_owner_update" on public.responses
  for update to authenticated
  using (public.is_form_owner(form_id))
  with check (public.is_form_owner(form_id));

create policy "responses_owner_delete" on public.responses
  for delete to authenticated
  using (public.is_form_owner(form_id));

create policy "responses_public_insert" on public.responses
  for insert to anon, authenticated
  with check (
    exists (
      select 1 from public.forms f
      where f.id = form_id
        and f.is_published = true
        and (
          f.response_cap is null
          or (select count(*) from public.responses r
              where r.form_id = f.id and r.submitted_at is not null) < f.response_cap
        )
    )
  );

-- answers: owner full control; public INSERT only into a response they
-- created and that has NOT been submitted yet (prevents post-hoc injection)
create policy "answers_owner_all" on public.answers
  for all to authenticated
  using (public.is_form_owner(
    (select r.form_id from public.responses r where r.id = response_id)
  ))
  with check (public.is_form_owner(
    (select r.form_id from public.responses r where r.id = response_id)
  ));

create policy "answers_public_insert" on public.answers
  for insert to anon, authenticated
  with check (
    exists (
      select 1 from public.responses r
      where r.id = response_id
        and r.submitted_at is null
    )
  );

-- payments: owner read-only (webhooks/service role write)
create policy "payments_owner_read" on public.payments
  for select to authenticated
  using (public.is_form_owner(
    (select r.form_id from public.responses r where r.id = response_id)
  ));

-- webhook_events: no client policies at all — service role only

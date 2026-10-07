-- ============================================================================
-- MineForm feature batch (Oct 2026)
--  - forms: settings, scoring_config, ending_config, design_config,
--    integrations, access_config (all JSONB so no downtime / destructive ops)
--  - responses: score, ending_id, locale
--  - questions: translations (i18n), shuffle_options
--  - new tables: form_collaborators, audit_log, email_verifications,
--    public_templates
-- ============================================================================

-- ---------------------------------------------------------------------------
-- forms: feature config columns
-- ---------------------------------------------------------------------------
alter table public.forms
  add column if not exists settings jsonb not null default '{}'::jsonb,
  add column if not exists scoring_config jsonb not null default '{}'::jsonb,
  add column if not exists ending_config jsonb not null default '{}'::jsonb,
  add column if not exists design_config jsonb not null default '{}'::jsonb,
  add column if not exists integrations jsonb not null default '{}'::jsonb,
  add column if not exists access_config jsonb not null default '{}'::jsonb;

-- ---------------------------------------------------------------------------
-- responses: quiz score + which ending screen matched + answer locale
-- ---------------------------------------------------------------------------
alter table public.responses
  add column if not exists score int,
  add column if not exists ending_id text,
  add column if not exists locale text;

-- ---------------------------------------------------------------------------
-- questions: per-locale translations + option shuffle
-- ---------------------------------------------------------------------------
alter table public.questions
  add column if not exists translations jsonb not null default '{}'::jsonb,
  add column if not exists shuffle_options boolean not null default false;

-- ---------------------------------------------------------------------------
-- form_collaborators — team workspaces (owner / editor / viewer)
-- ---------------------------------------------------------------------------
create table if not exists public.form_collaborators (
  id uuid primary key default gen_random_uuid(),
  form_id uuid not null references public.forms (id) on delete cascade,
  user_id uuid references auth.users (id) on delete cascade,
  email text not null,
  role text not null check (role in ('editor', 'viewer')),
  created_at timestamptz not null default now(),
  unique (form_id, email)
);
create index if not exists form_collaborators_user_idx
  on public.form_collaborators (user_id);

alter table public.form_collaborators enable row level security;

create policy "form_collaborators_owner_all"
  on public.form_collaborators for all
  using (
    exists (select 1 from public.forms f where f.id = form_id and f.user_id = auth.uid())
  )
  with check (
    exists (select 1 from public.forms f where f.id = form_id and f.user_id = auth.uid())
  );

create policy "form_collaborators_member_read"
  on public.form_collaborators for select
  using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- audit_log — who changed what (service role inserts; owner reads)
-- ---------------------------------------------------------------------------
create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),
  form_id uuid not null references public.forms (id) on delete cascade,
  actor text not null,
  action text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists audit_log_form_idx
  on public.audit_log (form_id, created_at desc);

alter table public.audit_log enable row level security;

create policy "audit_log_owner_read"
  on public.audit_log for select
  using (
    exists (select 1 from public.forms f where f.id = form_id and f.user_id = auth.uid())
  );

-- ---------------------------------------------------------------------------
-- email_verifications — one-response-per-email flow
-- ---------------------------------------------------------------------------
create table if not exists public.email_verifications (
  id uuid primary key default gen_random_uuid(),
  form_id uuid not null references public.forms (id) on delete cascade,
  email text not null,
  token_hash text not null,
  verified_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists email_verifications_token_idx
  on public.email_verifications (token_hash);

alter table public.email_verifications enable row level security;
-- Service-role only (no policies): verification rows are never client-visible.

-- ---------------------------------------------------------------------------
-- public_templates — free community template marketplace
-- ---------------------------------------------------------------------------
create table if not exists public.public_templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  author_email text,
  name text not null check (char_length(name) between 1 and 120),
  description text not null default '',
  definition jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.public_templates enable row level security;

create policy "public_templates_read_all"
  on public.public_templates for select
  using (true);

create policy "public_templates_owner_insert"
  on public.public_templates for insert
  with check (user_id = auth.uid());

create policy "public_templates_owner_delete"
  on public.public_templates for delete
  using (user_id = auth.uid());

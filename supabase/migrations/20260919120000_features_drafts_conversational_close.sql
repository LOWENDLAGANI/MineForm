-- ============================================================================
-- MineForm feature migration
--   1. Save-and-resume drafts: recovery token + saved answers per response
--   2. Conversational renderer mode (one question per screen)
--   3. Respondent confirmation email setting
--   4. Close conditions: auto-close by date, and conditional close
--      ("close when N respondents answered X to question Y")
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Drafts: a response can hold a recovery token + in-progress answers.
--    answers_submit_check relaxed? No — answers stay INSERT-only on open
--    responses (unchanged RLS). Draft answers are just answers rows on an
--    unsubmitted response; the service role reads them for resume.
-- ---------------------------------------------------------------------------
alter table public.responses
  add column if not exists recovery_token text,
  add column if not exists recovery_token_created_at timestamptz;

create unique index if not exists responses_recovery_token_idx
  on public.responses (recovery_token)
  where recovery_token is not null;

create index if not exists responses_form_open_idx
  on public.responses (form_id, started_at desc)
  where submitted_at is null;

-- ---------------------------------------------------------------------------
-- 2. Renderer mode + confirmation email on forms
-- ---------------------------------------------------------------------------
alter table public.forms
  add column if not exists renderer_mode text not null default 'classic'
    check (renderer_mode in ('classic', 'conversational')),
  add column if not exists send_confirmation_email boolean not null default false,
  add column if not exists close_config jsonb not null default '{}'::jsonb;

-- ---------------------------------------------------------------------------
-- 3. Close conditions on forms.
--    close_config JSONB shape (all keys optional):
--      { "close_at": "2026-10-01T00:00:00Z" }                       — date close
--      { "conditions": [ { "question_id": uuid, "operator": "eq",
--                          "value": "yes", "count": 50 } ] }        — conditional
-- ---------------------------------------------------------------------------

-- Re-open gate: FORM_CLOSED error when closed. The close check lives here so
-- every insert/update path (start, submit, drafts) is covered by one trigger.
create or replace function public.enforce_close_conditions()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  f public.forms;
  n bigint;
  cond jsonb;
  qid uuid;
begin
  select * into f from public.forms where id = new.form_id;
  if not found then
    raise exception 'FORM_NOT_FOUND';
  end if;

  -- Date close
  if f.close_config ? 'close_at'
     and f.close_config ->> 'close_at' is not null
     and now() > (f.close_config ->> 'close_at')::timestamptz then
    raise exception 'FORM_CLOSED';
  end if;

  -- Conditional close: any single condition being met closes the form
  for cond in select jsonb_array_elements(coalesce(f.close_config -> 'conditions', '[]'::jsonb))
  loop
    qid := (cond ->> 'question_id')::uuid;

    select count(*) into n
    from public.responses r
    join public.answers a on a.response_id = r.id
    where r.form_id = new.form_id
      and r.submitted_at is not null
      and a.question_id = qid
      and (
        case (cond ->> 'operator')
          when 'eq' then
            (a.answer_text is not null and a.answer_text = cond ->> 'value')
            or (a.answer_json is not null and a.answer_json::text = cond ->> 'value')
            or (jsonb_typeof(a.answer_json) = 'array' and a.answer_json ? cond ->> 'value')
          when 'contains' then
            (a.answer_text is not null and a.answer_text like '%' || (cond ->> 'value') || '%')
            or (jsonb_typeof(a.answer_json) = 'array' and a.answer_json ? cond ->> 'value')
            or (a.answer_json is not null and jsonb_typeof(a.answer_json) <> 'array'
                and a.answer_json::text like '%' || (cond ->> 'value') || '%')
          else false
        end
      );

    if n >= coalesce((cond ->> 'count')::int, 1) then
      raise exception 'FORM_CLOSED';
    end if;
  end loop;

  return new;
end;
$$;

create trigger responses_enforce_close
  before insert or update of submitted_at, expires_at on public.responses
  for each row execute function public.enforce_close_conditions();

-- ---------------------------------------------------------------------------
-- 4. Recovery token issuance: service role generates tokens via this function
--    (server clock + pgcrypto; client code never supplies tokens)
-- ---------------------------------------------------------------------------
create or replace function public.issue_recovery_token(rid uuid)
returns text
language plpgsql security definer set search_path = public as $$
declare
  tok text;
begin
  -- 32 bytes of entropy, url-safe
  tok := encode(gen_random_bytes(24), 'base64');
  tok := replace(replace(tok, '+', '-'), '/', '_');

  update public.responses
  set recovery_token = tok,
      recovery_token_created_at = now()
  where id = rid and submitted_at is null;

  if not found then
    return null; -- already submitted; no token
  end if;

  return tok;
end;
$$;

-- Responses table: realtime publication already includes responses/answers.
-- Close evaluation also benefits from answers being visible; unchanged.

-- ---------------------------------------------------------------------------
-- 5. Public availability helper data: expose close state in the API is done
--    in Next routes (close_config is readable there). RLS unchanged — the
--    public read policy already exposes published forms.
-- ---------------------------------------------------------------------------

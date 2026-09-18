-- Add responses + answers to the realtime publication so owners can listen
-- for new submissions live. Postgres Changes over an authenticated Supabase
-- channel still enforces RLS: a subscriber only receives rows their token
-- may SELECT (responses_owner_select / answers_owner_all), so respondents
-- and other users see nothing.
alter publication supabase_realtime add table public.responses;
alter publication supabase_realtime add table public.answers;

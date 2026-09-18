-- questions: drop the hard-unique (form_id, order_index) constraint.
-- The builder now upserts the full question set in one call; a hard unique
-- constraint makes reordering two rows transiently conflict. A plain index
-- still keeps form_id + order_index lookups fast; order integrity is owned
-- by the API (it always writes the whole ordered set).
alter table public.questions
  drop constraint if exists questions_form_id_order_index_key;

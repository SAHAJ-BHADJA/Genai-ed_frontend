-- Store per-assignment Socratic stage guidance and the exact starter
-- messages shown to students when they open the studio.

ALTER TABLE public.assignment_socratic_configs
  ADD COLUMN IF NOT EXISTS clarify_custom_instructions text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS research_custom_instructions text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS build_custom_instructions text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS write_custom_instructions text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS clarify_starter_response text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS research_starter_response text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS build_starter_response text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS write_starter_response text NOT NULL DEFAULT '';

NOTIFY pgrst, 'reload schema';

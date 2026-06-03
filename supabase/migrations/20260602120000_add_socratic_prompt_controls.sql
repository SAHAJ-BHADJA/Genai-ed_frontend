-- Store the editable Socratic AI prompt layers that educators configure per assignment.

ALTER TABLE public.assignment_socratic_configs
  ADD COLUMN IF NOT EXISTS global_prompt text,
  ADD COLUMN IF NOT EXISTS chat_response_instructions text,
  ADD COLUMN IF NOT EXISTS readiness_generation_system_prompt text,
  ADD COLUMN IF NOT EXISTS readiness_generation_user_prompt text,
  ADD COLUMN IF NOT EXISTS starter_response_instructions text,
  ADD COLUMN IF NOT EXISTS clarify_starter_prompt text,
  ADD COLUMN IF NOT EXISTS research_starter_prompt text,
  ADD COLUMN IF NOT EXISTS build_starter_prompt text,
  ADD COLUMN IF NOT EXISTS write_starter_prompt text;

NOTIFY pgrst, 'reload schema';

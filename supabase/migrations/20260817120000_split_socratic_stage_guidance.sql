-- Split the old per-stage Socratic guidance into two educator-controlled lanes:
-- one for hidden readiness goal generation, and one for opening-message generation.

ALTER TABLE public.assignment_socratic_configs
  ADD COLUMN IF NOT EXISTS clarify_readiness_guidance text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS research_readiness_guidance text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS build_readiness_guidance text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS write_readiness_guidance text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS clarify_starter_guidance text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS research_starter_guidance text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS build_starter_guidance text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS write_starter_guidance text NOT NULL DEFAULT '';

UPDATE public.assignment_socratic_configs
SET
  clarify_readiness_guidance = COALESCE(NULLIF(clarify_readiness_guidance, ''), clarify_custom_instructions, ''),
  research_readiness_guidance = COALESCE(NULLIF(research_readiness_guidance, ''), research_custom_instructions, ''),
  build_readiness_guidance = COALESCE(NULLIF(build_readiness_guidance, ''), build_custom_instructions, ''),
  write_readiness_guidance = COALESCE(NULLIF(write_readiness_guidance, ''), write_custom_instructions, ''),
  clarify_starter_guidance = COALESCE(NULLIF(clarify_starter_guidance, ''), clarify_custom_instructions, ''),
  research_starter_guidance = COALESCE(NULLIF(research_starter_guidance, ''), research_custom_instructions, ''),
  build_starter_guidance = COALESCE(NULLIF(build_starter_guidance, ''), build_custom_instructions, ''),
  write_starter_guidance = COALESCE(NULLIF(write_starter_guidance, ''), write_custom_instructions, '');

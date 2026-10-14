/*
  # Socratic assignment builder v2

  Adds:
  - stage availability and verification metadata for newly-created Socratic assignments

  Existing Socratic assignments retain the original four-stage behavior through defaults.
*/

ALTER TABLE public.assignment_socratic_configs
  ADD COLUMN IF NOT EXISTS builder_version text NOT NULL DEFAULT 'v1',
  ADD COLUMN IF NOT EXISTS verification_method text NOT NULL DEFAULT 'online_quiz',
  ADD COLUMN IF NOT EXISTS clarify_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS research_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS build_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS write_enabled boolean NOT NULL DEFAULT true;

ALTER TABLE public.assignment_socratic_configs
  DROP CONSTRAINT IF EXISTS assignment_socratic_configs_builder_version_check,
  DROP CONSTRAINT IF EXISTS assignment_socratic_configs_verification_method_check,
  DROP CONSTRAINT IF EXISTS assignment_socratic_configs_write_enabled_check;

ALTER TABLE public.assignment_socratic_configs
  ADD CONSTRAINT assignment_socratic_configs_builder_version_check
    CHECK (builder_version IN ('v1', 'wizard_v2')),
  ADD CONSTRAINT assignment_socratic_configs_verification_method_check
    CHECK (verification_method = 'online_quiz'),
  ADD CONSTRAINT assignment_socratic_configs_write_enabled_check
    CHECK (write_enabled = true);

NOTIFY pgrst, 'reload schema';

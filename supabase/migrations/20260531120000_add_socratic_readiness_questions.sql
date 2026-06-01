alter table public.assignment_socratic_configs
  add column if not exists clarify_readiness_questions jsonb not null default '[]'::jsonb,
  add column if not exists research_readiness_questions jsonb not null default '[]'::jsonb,
  add column if not exists build_readiness_questions jsonb not null default '[]'::jsonb,
  add column if not exists write_readiness_questions jsonb not null default '[]'::jsonb;

notify pgrst, 'reload schema';

alter table public.llm_playground_runs
  add column if not exists target_run_id uuid
    references public.llm_playground_runs(id) on delete cascade;

alter table public.llm_playground_runs
  add column if not exists completed_at timestamptz;

alter table public.llm_playground_runs
  drop constraint if exists llm_playground_runs_mode_check;

alter table public.llm_playground_runs
  add constraint llm_playground_runs_mode_check
  check (mode in ('single', 'compare', 'multi-judge', 'single-judge', 'synthesis'));

alter table public.llm_playground_messages
  drop constraint if exists llm_playground_messages_mode_check;

alter table public.llm_playground_messages
  add constraint llm_playground_messages_mode_check
  check (mode in ('single', 'compare', 'multi-judge', 'single-judge', 'synthesis'));

create index if not exists idx_llm_playground_runs_target_run
  on public.llm_playground_runs(target_run_id, created_at);

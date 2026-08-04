create extension if not exists pgcrypto;

create table if not exists public.llm_playground_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  user_role text not null default 'educator' check (user_role in ('educator', 'student')),
  title text not null default 'New chat',
  active_mode text not null default 'single' check (active_mode in ('single', 'compare', 'multi-judge', 'single-judge')),
  active_model_id text,
  settings jsonb not null default '{}'::jsonb,
  summary text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.llm_playground_runs (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.llm_playground_conversations(id) on delete cascade,
  mode text not null check (mode in ('single', 'compare', 'multi-judge', 'single-judge')),
  prompt text not null default '',
  request_settings jsonb not null default '{}'::jsonb,
  context_snapshot text,
  status text not null default 'succeeded' check (status in ('running', 'succeeded', 'failed')),
  error_message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.llm_playground_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.llm_playground_conversations(id) on delete cascade,
  run_id uuid references public.llm_playground_runs(id) on delete set null,
  turn_index integer not null default 0,
  role text not null check (role in ('user', 'assistant')),
  content text not null default '',
  mode text check (mode in ('single', 'compare', 'multi-judge', 'single-judge')),
  model_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.llm_playground_model_outputs (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.llm_playground_runs(id) on delete cascade,
  model_id text not null,
  output_text text not null default '',
  latency_ms integer not null default 0,
  error_message text,
  structured jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.llm_playground_judgements (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.llm_playground_runs(id) on delete cascade,
  judge_model_id text,
  judgement_type text not null default 'report',
  judgement_text text not null default '',
  structured jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_llm_playground_conversations_user_updated
  on public.llm_playground_conversations(user_id, updated_at desc);

create index if not exists idx_llm_playground_messages_conversation_turn
  on public.llm_playground_messages(conversation_id, turn_index, created_at);

create index if not exists idx_llm_playground_runs_conversation_created
  on public.llm_playground_runs(conversation_id, created_at desc);

create or replace function public.set_llm_playground_conversation_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_llm_playground_conversations_updated_at on public.llm_playground_conversations;
create trigger trg_llm_playground_conversations_updated_at
before update on public.llm_playground_conversations
for each row execute function public.set_llm_playground_conversation_updated_at();

alter table public.llm_playground_conversations enable row level security;
alter table public.llm_playground_messages enable row level security;
alter table public.llm_playground_runs enable row level security;
alter table public.llm_playground_model_outputs enable row level security;
alter table public.llm_playground_judgements enable row level security;

create policy "llm playground conversations select own"
on public.llm_playground_conversations
for select
using (auth.uid() = user_id);

create policy "llm playground conversations insert own"
on public.llm_playground_conversations
for insert
with check (auth.uid() = user_id);

create policy "llm playground conversations update own"
on public.llm_playground_conversations
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "llm playground conversations delete own"
on public.llm_playground_conversations
for delete
using (auth.uid() = user_id);

create policy "llm playground messages own conversation"
on public.llm_playground_messages
for all
using (
  exists (
    select 1
    from public.llm_playground_conversations c
    where c.id = conversation_id
      and c.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.llm_playground_conversations c
    where c.id = conversation_id
      and c.user_id = auth.uid()
  )
);

create policy "llm playground runs own conversation"
on public.llm_playground_runs
for all
using (
  exists (
    select 1
    from public.llm_playground_conversations c
    where c.id = conversation_id
      and c.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.llm_playground_conversations c
    where c.id = conversation_id
      and c.user_id = auth.uid()
  )
);

create policy "llm playground outputs own run"
on public.llm_playground_model_outputs
for all
using (
  exists (
    select 1
    from public.llm_playground_runs r
    join public.llm_playground_conversations c on c.id = r.conversation_id
    where r.id = run_id
      and c.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.llm_playground_runs r
    join public.llm_playground_conversations c on c.id = r.conversation_id
    where r.id = run_id
      and c.user_id = auth.uid()
  )
);

create policy "llm playground judgements own run"
on public.llm_playground_judgements
for all
using (
  exists (
    select 1
    from public.llm_playground_runs r
    join public.llm_playground_conversations c on c.id = r.conversation_id
    where r.id = run_id
      and c.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.llm_playground_runs r
    join public.llm_playground_conversations c on c.id = r.conversation_id
    where r.id = run_id
      and c.user_id = auth.uid()
  )
);

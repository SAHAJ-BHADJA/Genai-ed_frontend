# Multi-Model LLM Playground Redesign

## Goal

Redesign the current Multi-Model LLM Playground so every chat has persistent history, shared context, and mode switching across all four modes:

- Single Model
- Compare and Orchestrate
- Multi Judge
- Single Judge

The key product behavior: a user should be able to ask a question in one mode, switch to another mode, and continue the same conversation with full context.

## Current Problem

Today, each mode behaves too independently. If a user asks:

> What is the location of USC?

Then switches mode and asks:

> What about the other campuses?

The system may not reliably understand that "other campuses" refers to USC because the conversation state is not treated as one shared thread across modes.

## Target Flow

### Example: USC Location Conversation

1. User opens Multi-Model Playground.
2. User starts in Single Model mode with Claude selected.
3. User asks:

   ```text
   What is the location of USC?
   ```

4. Claude answers:

   ```text
   USC's main campus is the University Park Campus in Los Angeles, California.
   ```

5. User switches to Compare and Orchestrate mode.
6. User asks:

   ```text
   What about its other campuses?
   ```

7. Backend sends the previous conversation context to all selected models, so each model understands "its" means USC.
8. OpenAI, Gemini, and Claude each answer using the same conversation history.
9. The orchestrator creates one final answer from those model outputs.
10. User switches to Single Judge mode and asks:

    ```text
    Which answer was most accurate?
    ```

11. The judge model sees the previous user messages, model outputs, and orchestrated answer, then evaluates them.

## Core UX Rules

- One conversation thread should remain active across all four modes.
- Switching mode must not clear chat history.
- Every user message should belong to the same conversation unless the user explicitly starts a new chat.
- Each mode can show different UI, but all modes should read and write to the same conversation state.
- Individual model outputs should be preserved, not overwritten by the final orchestrated answer.
- The visible chat should show the user message and the main response for that mode.
- Advanced outputs like individual model responses, judge scores, and rationales should be expandable.

## State Model

Each conversation should contain:

- User messages.
- Main assistant responses.
- Mode used for each turn.
- Model selected for each turn.
- Individual model outputs for compare/judge modes.
- Orchestrated final answer.
- Judge evaluations.
- Generation settings such as temperature and max tokens.
- Rolling summary for long conversations.

## Database Changes

### 1. `llm_playground_conversations`

Stores one persistent chat thread.

```sql
create table if not exists llm_playground_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  user_role text check (user_role in ('educator', 'student')),
  title text,
  active_mode text not null default 'single',
  active_model_id text,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);
```

### 2. `llm_playground_messages`

Stores the visible conversation messages.

```sql
create table if not exists llm_playground_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references llm_playground_conversations(id) on delete cascade,
  turn_index integer not null,
  role text not null check (role in ('user', 'assistant', 'system')),
  content text not null,
  mode text,
  model_id text,
  run_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
```

### 3. `llm_playground_runs`

Stores each model execution event.

```sql
create table if not exists llm_playground_runs (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references llm_playground_conversations(id) on delete cascade,
  user_message_id uuid references llm_playground_messages(id) on delete set null,
  mode text not null check (mode in ('single', 'compare', 'multi_judge', 'single_judge')),
  status text not null default 'running',
  request_settings jsonb not null default '{}'::jsonb,
  context_snapshot jsonb not null default '{}'::jsonb,
  error_message text,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);
```

### 4. `llm_playground_model_outputs`

Stores individual model responses.

```sql
create table if not exists llm_playground_model_outputs (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references llm_playground_runs(id) on delete cascade,
  model_id text not null,
  provider text,
  provider_model text,
  content text,
  raw_payload jsonb not null default '{}'::jsonb,
  status text not null default 'succeeded',
  error_message text,
  latency_ms integer,
  input_tokens integer,
  output_tokens integer,
  created_at timestamptz not null default now()
);
```

### 5. `llm_playground_judgements`

Stores judge/orchestration results.

```sql
create table if not exists llm_playground_judgements (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references llm_playground_runs(id) on delete cascade,
  judge_type text not null check (judge_type in ('orchestrate', 'multi_judge', 'single_judge')),
  judge_model_id text,
  final_answer text,
  rationale text,
  scores jsonb not null default '{}'::jsonb,
  selected_output_ids uuid[] not null default '{}',
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
```

### 6. `llm_playground_context_summaries`

Stores compressed context for long conversations.

```sql
create table if not exists llm_playground_context_summaries (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references llm_playground_conversations(id) on delete cascade,
  summary_text text not null,
  summarized_until_turn integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

### Required Indexes

```sql
create index if not exists idx_llm_conversations_user_updated
on llm_playground_conversations(user_id, updated_at desc);

create index if not exists idx_llm_messages_conversation_turn
on llm_playground_messages(conversation_id, turn_index);

create index if not exists idx_llm_runs_conversation_started
on llm_playground_runs(conversation_id, started_at desc);

create index if not exists idx_llm_outputs_run
on llm_playground_model_outputs(run_id);
```

### RLS Requirements

- Users can only read/write their own conversations.
- Educator and student portals can share the same tables, separated by `user_id` and `user_role`.
- Admin/service role can inspect records for debugging if needed.

## Backend Logic Changes

### 1. Conversation Lifecycle

Add endpoints:

```text
POST /api/llm-playground/conversations
GET  /api/llm-playground/conversations
GET  /api/llm-playground/conversations/{conversation_id}
PATCH /api/llm-playground/conversations/{conversation_id}
DELETE /api/llm-playground/conversations/{conversation_id}
```

Behavior:

- Create a new conversation when the user starts a new chat.
- Load the latest conversation by default.
- Archive instead of hard delete unless the user explicitly clears data.
- Update `active_mode`, selected model, and settings without deleting history.

### 2. Shared Context Builder

Create one backend function:

```python
build_llm_playground_context(conversation_id, current_mode, max_tokens)
```

It should include:

- Conversation summary if available.
- Recent user and assistant messages.
- Important previous model outputs.
- Previous orchestrated answers.
- Previous judge conclusions.
- Current mode instructions.

Context order:

1. System instruction.
2. Rolling summary.
3. Recent conversation messages.
4. Relevant model outputs/judgements.
5. Current user message.

### 3. Single Model Mode

Endpoint:

```text
POST /api/llm-playground/conversations/{conversation_id}/single/stream
```

Backend flow:

1. Save user message.
2. Build shared context.
3. Call selected model with streaming.
4. Save assistant response.
5. Save run row and model output row.
6. Return streamed text to frontend.

### 4. Compare and Orchestrate Mode

Endpoint:

```text
POST /api/llm-playground/conversations/{conversation_id}/compare
```

Backend flow:

1. Save user message.
2. Build shared context once.
3. Send same context to selected models.
4. Save every individual model output.
5. Send model outputs to orchestrator model.
6. Save orchestrated final answer as the visible assistant message.
7. Save individual outputs in expandable metadata.

### 5. Multi Judge Mode

Endpoint:

```text
POST /api/llm-playground/conversations/{conversation_id}/judge/multi
```

Backend flow:

1. Save user message.
2. Build shared context.
3. Generate or reuse candidate model outputs.
4. Judge compares outputs across criteria such as accuracy, completeness, clarity, and usefulness.
5. Save scores, rationale, selected winner, and final answer.

### 6. Single Judge Mode

Endpoint:

```text
POST /api/llm-playground/conversations/{conversation_id}/judge/single
```

Backend flow:

1. Save user message.
2. Build shared context.
3. Generate or reuse one selected model output.
4. Judge evaluates that output against the user question and conversation history.
5. Save judge rationale and recommendation.

### 7. Mode Switching

Endpoint:

```text
PATCH /api/llm-playground/conversations/{conversation_id}
```

Payload:

```json
{
  "activeMode": "compare",
  "activeModelId": "claude-opus-4.5",
  "settings": {
    "temperature": 0.2,
    "maxTokens": 2000
  }
}
```

Mode switch should only update settings. It must not create a new chat or clear messages.

### 8. Context Summarization

When a conversation becomes long:

1. Summarize older turns.
2. Store summary in `llm_playground_context_summaries`.
3. Keep last N turns verbatim.
4. Use summary plus recent messages in future calls.

Example summary:

```text
The user is asking about USC locations. Previous answer established that USC's main campus is University Park Campus in Los Angeles. The user may ask follow-up questions referring to USC as "it" or "its".
```

### 9. JSON/Formatting Safety

For Gemini and other models that sometimes return malformed JSON:

- Separate user-facing answer from internal JSON parsing.
- If JSON parsing fails, extract usable text instead of showing raw JSON.
- Save raw payload for debugging.
- Never show broken JSON as the final answer unless debug mode is enabled.

## Frontend Changes

### 1. Conversation Sidebar

Add a left or collapsible sidebar:

- New Chat
- Recent conversations
- Search conversations
- Rename conversation
- Archive/delete conversation

### 2. Persistent Active Conversation

Frontend should store:

```ts
activeConversationId
activeMode
activeModelId
settings
```

Load conversation from backend on page open. Do not rely only on local React state.

### 3. Mode Switcher

The four mode tabs should switch mode inside the same conversation:

- Single Model
- Compare and Orchestrate
- Multi Judge
- Single Judge

Switching tabs should call:

```text
PATCH /api/llm-playground/conversations/{conversation_id}
```

It should not reset the chat window.

### 4. Unified Chat Timeline

All modes should render inside one timeline:

```text
User: What is the location of USC?
Assistant: USC's main campus is the University Park Campus in Los Angeles...

User: What about its other campuses?
Assistant: USC also has the Health Sciences Campus...
```

Each assistant message should show a small badge:

```text
Claude Opus 4.5
Compare and Orchestrate
Single Judge
```

### 5. Expandable Run Details

For compare/judge modes, show:

- Final answer by default.
- Expandable individual model outputs.
- Expandable judge rationale.
- Scores if available.
- Raw debug payload only in developer/debug mode.

### 6. Streaming

Single Model should continue streaming.

For Compare and Judge modes:

- Show per-model loading states.
- Stream if backend supports it.
- Otherwise show progress states:
  - Calling OpenAI
  - Calling Gemini
  - Calling Claude
  - Orchestrating final answer
  - Saving response

### 7. Clear UX Rule

The input box should always say what context it will use:

```text
Continue this conversation with Claude...
Compare selected models using this conversation...
Judge the previous answers using this conversation...
```

### 8. Example UI Behavior

User starts in Single Model:

```text
User: What is the location of USC?
Claude: USC's main campus is the University Park Campus in Los Angeles, California.
```

User switches to Compare:

```text
User: What about its other campuses?
Final Answer: USC also has the Health Sciences Campus in Los Angeles, plus additional research and program locations such as Marina del Rey, Playa Vista, Catalina Island, Washington D.C., Sacramento, and Orange County.
```

The model understands "its" because backend sent the previous message about USC.

User switches to Single Judge:

```text
User: Was the previous answer complete?
Judge: Mostly complete. It correctly identified major USC locations, but it should distinguish official campuses from research centers and program locations.
```

## Implementation Priority

1. Add DB tables and RLS.
2. Add conversation CRUD endpoints.
3. Add shared context builder.
4. Convert Single Model mode to persistent conversations.
5. Convert Compare and Orchestrate mode.
6. Convert Multi Judge and Single Judge modes.
7. Add context summarization.
8. Update frontend timeline and mode switcher.
9. Add conversation sidebar.
10. Add tests for context continuity across modes.

## Testing Checklist

- Ask "What is the location of USC?" in Single Model.
- Switch to Compare and ask "What about its other campuses?"
- Confirm all selected models understand "its" means USC.
- Switch to Single Judge and ask "Was the previous answer accurate?"
- Refresh page and confirm conversation is still present.
- Start new chat and confirm previous context does not leak.
- Compare long conversation behavior after summarization.
- Confirm student and educator users only see their own conversations.
- Confirm malformed Gemini JSON does not show as raw broken JSON in the final answer.


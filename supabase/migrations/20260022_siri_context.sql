-- Stores the last N message pairs per Siri token so the agent remembers context
-- across separate shortcut invocations. Stored as a JSON array of {role, content}.
alter table public.user_tokens
  add column if not exists siri_context jsonb not null default '[]'::jsonb;

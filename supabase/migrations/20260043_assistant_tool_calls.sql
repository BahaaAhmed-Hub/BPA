-- Tool calls for the server-generated assistant (step 4–6 of the chat move).
--
-- The model is called from an edge function so an answer keeps arriving when the
-- iPad dims and the page dies. The assistant's TOOLS, though, run in the browser:
-- they read and write the app's own stores and wait on an approval card that is
-- a click away. So when the model asks for a tool the function does not run it —
-- it parks the call as a row (`role = 'tool'`, `tool_state = 'running'`) and
-- stops. Whichever open device claims the row runs it (approval card and all),
-- writes `tool_result`, and asks the function to continue.
--
-- **`turn`** is the in-flight turn in the provider's own message format (the
-- assistant's tool_use blocks, the results so far). It is the only place full API
-- fidelity is kept, it exists only while a turn is open, and it is cleared when
-- the turn completes — history across turns stays plain text.
--
-- **One streaming answer per conversation**, enforced by an index: it is the
-- lock. A double-tapped Send, two devices both asking to continue, a retried
-- request — the second insert fails (23505) instead of two answers racing.
--
-- **A tool call is claimed once.** `claimed_by`/`claimed_at` are taken with a
-- conditional update, so two open devices cannot both run `delete_task`. A claim
-- older than two minutes may be taken over (the device that took it has gone).
--
-- Safe to run more than once.

alter table public.assistant_conversations add column if not exists turn jsonb;

alter table public.assistant_messages add column if not exists tool_use_id text;
alter table public.assistant_messages add column if not exists tool_input  jsonb;
alter table public.assistant_messages add column if not exists tool_result text;
alter table public.assistant_messages add column if not exists claimed_by  text;
alter table public.assistant_messages add column if not exists claimed_at  timestamptz;

create unique index if not exists assistant_one_streaming
  on public.assistant_messages (conversation_id) where status = 'streaming';

-- Plain (not partial) so PostgREST's upsert can name it; NULLs never collide.
create unique index if not exists assistant_tool_use_uniq
  on public.assistant_messages (conversation_id, tool_use_id);

-- 20260042 first shipped this index as a PARTIAL one (`where client_id is not null`), and editing a migration does not
-- change an index that already exists. PostgREST's upsert can only name columns, never a predicate, so make the
-- project's index the plain one the file now describes. NULLs never collide in a unique index, so nothing about which
-- rows are accepted changes.
drop index if exists public.assistant_messages_client_uniq;
create unique index if not exists assistant_messages_client_uniq
  on public.assistant_messages (conversation_id, client_id);


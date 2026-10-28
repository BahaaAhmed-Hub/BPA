-- What an answer cost, kept on the answer.
--
-- Both providers report the tokens a reply used (Anthropic in `message_start` / `message_delta`, Groq in `usage`), and
-- that is the only exact number there is: neither exposes a balance to an ordinary key. Keeping it on the row that
-- produced it means a conversation's total is a sum of its rows, the month's total is a sum over a date range, and
-- every device that reads the thread sees the same figures — which a counter in this browser's localStorage could not give.
--
--   usage = {"input": 1234, "output": 56, "cacheRead": 0, "cacheWrite": 0, "model": "...", "provider": "anthropic"|"groq"}
--
-- One step of the model is one row's worth: a step that only asked for tools keeps its (empty) answer row so its tokens
-- are counted — a tool loop is several requests and every one of them is billed.
--
-- Safe to run more than once.

alter table public.assistant_messages add column if not exists usage jsonb;

-- "This month": a range scan over one person's rows that have a usage.
create index if not exists assistant_messages_usage_idx
  on public.assistant_messages (user_id, created_at) where usage is not null;

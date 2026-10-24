#!/usr/bin/env bash
# 20260042_assistant_conversations.sql, applied to a throwaway Postgres and then
# argued with.
#
# The claims worth proving are the ones a reader of the file has to take on
# trust: that nobody can read, write into or delete another person's
# conversation; that a retried insert lands on one row; that the check
# constraints refuse bad rows FOR THE STATED REASON; that a second apply is a
# no-op; and that both tables are published for Realtime.
#
# Every refusal is asserted with its reason, and the last block is a CONTROL:
# with row-level security switched off the same reads succeed, so the "0 rows"
# above are RLS's doing and not an empty table.
#
# Usage:  scripts/assistant-conversations-sql.sh <socket-dir> [port]
# The caller owns the cluster; this script only talks to it.
set -uo pipefail

DIR="${1:?socket directory of a running postgres}"
PORT="${2:-5598}"
SQL="$(cd "$(dirname "$0")/.." && pwd)/supabase/migrations/20260042_assistant_conversations.sql"
SQL2="$(cd "$(dirname "$0")/.." && pwd)/supabase/migrations/20260043_assistant_tool_calls.sql"
SQL3="$(cd "$(dirname "$0")/.." && pwd)/supabase/migrations/20260044_assistant_usage.sql"

q() { psql -h "$DIR" -p "$PORT" -U bpa -d postgres -v ON_ERROR_STOP=1 -qtA "$@"; }

code=0
ok() { if [ "$2" = 1 ]; then echo "PASS  $1${3:+  $3}"; else echo "*** FAIL ***  $1${3:+  $3}"; code=1; fi; }

refused() { # refused <name> <error-pattern> <sql>
  local name=$1 want=$2 sql=$3 out
  out=$(q -c "$sql" 2>&1)
  if [ $? = 0 ]; then ok "$name" 0 "it was allowed"
  elif echo "$out" | grep -qi -- "$want"; then ok "$name" 1
  else ok "$name" 0 "refused, but for: $(echo "$out" | grep -i '^ERROR' | head -1 | cut -c1-90)"; fi
}
allowed() { # allowed <name> <sql>
  local name=$1 sql=$2 out
  out=$(q -c "$sql" 2>&1)
  if [ $? = 0 ]; then ok "$name" 1; else ok "$name" 0 "$(echo "$out" | grep -i '^ERROR' | head -1 | cut -c1-90)"; fi
}
is() { # is <name> <want> <sql> — the first line of the answer must equal want
  local name=$1 want=$2 sql=$3 got
  got=$(q -c "$sql" 2>&1 | head -1)
  [ "$got" = "$want" ] && ok "$name" 1 || ok "$name" 0 "wanted '$want', got '$got'"
}

A=11111111-1111-1111-1111-111111111111
B=22222222-2222-2222-2222-222222222222
CA=aaaaaaaa-0000-0000-0000-000000000001
CB=bbbbbbbb-0000-0000-0000-000000000001
M1=cccccccc-0000-0000-0000-000000000001

# Session-level `set`, never `set local` (each psql call is its own session).
AS_A="set role authenticated; set \"test.uid\" = '$A';"
AS_B="set role authenticated; set \"test.uid\" = '$B';"
AS_ANON="set role anon; set \"test.uid\" = '';"

# ─── The world the migration expects ────────────────────────────────────────
q >/dev/null <<SQL
drop table if exists public.assistant_messages, public.assistant_conversations cascade;
drop schema if exists auth cascade;
create schema auth;
create table auth.users (id uuid primary key);
insert into auth.users values ('$A'), ('$B');
create or replace function auth.uid() returns uuid language sql stable as \$\$
  select nullif(current_setting('test.uid', true), '')::uuid
\$\$;
do \$\$ begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'anon')          then create role anon;          end if;
end \$\$;
grant usage on schema public, auth to authenticated, anon;
grant execute on function auth.uid() to authenticated, anon;
SQL

# ─── Apply, and apply again ─────────────────────────────────────────────────
q -f "$SQL" >/dev/null 2>&1 && ok "it applies" 1 || ok "it applies" 0
q -f "$SQL" >/dev/null 2>&1 && ok "a second apply exits 0" 1 || ok "a second apply exits 0" 0
q -f "$SQL2" >/dev/null 2>&1 && ok "20260043 applies on top" 1 || ok "20260043 applies on top" 0
q -f "$SQL2" >/dev/null 2>&1 && ok "20260043 second apply exits 0" 1 || ok "20260043 second apply exits 0" 0
# A project that already ran the first version of 20260042 has the client_id index as a PARTIAL one. 20260043 must turn it
# into the plain one PostgREST can upsert against. Recreate that state, then apply.
q >/dev/null -c "drop index public.assistant_messages_client_uniq; create unique index assistant_messages_client_uniq on public.assistant_messages (conversation_id, client_id) where client_id is not null"
is "CONTROL: the old partial index is in place before the repair" 1 "select count(*) from pg_indexes where indexname='assistant_messages_client_uniq' and indexdef ilike '%where%'"
q -f "$SQL2" >/dev/null 2>&1
is "20260043 turns it into the plain index" 0 "select count(*) from pg_indexes where indexname='assistant_messages_client_uniq' and indexdef ilike '%where%'"
is "…and it is still unique on (conversation_id, client_id)" 1 "select count(*) from pg_indexes where indexname='assistant_messages_client_uniq' and indexdef ilike '%(conversation_id, client_id)%'"

# Supabase grants these by default; granted here so every refusal below is RLS's
# and not a missing privilege.
q >/dev/null <<SQL
grant select, insert, update, delete on public.assistant_conversations, public.assistant_messages to authenticated, anon;
grant usage, select on sequence public.assistant_messages_id_seq to authenticated, anon;
SQL

# ─── Realtime ───────────────────────────────────────────────────────────────
is "both tables are published for Realtime (once each, after two applies)" 2 \
  "select count(*) from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename in ('assistant_conversations','assistant_messages')"

# ─── The owner can do the whole job ─────────────────────────────────────────
allowed "A creates a conversation" "$AS_A insert into public.assistant_conversations(id,user_id,provider) values ('$CA','$A','anthropic')"
allowed "A writes a user message and a streaming answer in ONE statement" \
  "$AS_A insert into public.assistant_messages(conversation_id,user_id,client_id,role,content,status) values
     ('$CA','$A','$M1','user','hello','complete'),
     ('$CA','$A',null,'assistant','','streaming')"
allowed "A grows the streaming answer, then completes it" \
  "$AS_A update public.assistant_messages set content='hi there', status='complete' where conversation_id='$CA' and role='assistant'"
allowed "A records a tool chip with its state and a file chip on a user turn" \
  "$AS_A insert into public.assistant_messages(conversation_id,user_id,role,content,tool,tool_state,files) values
     ('$CA','$A','tool','Reading habits…','list_habits','done',null),
     ('$CA','$A','user','see this',null,null,'[{\"name\":\"inv.pdf\",\"kind\":\"pdf\"}]')"
is "A reads back all four rows" 4 "$AS_A select count(*) from public.assistant_messages where conversation_id='$CA'"
is "ordering by id puts the question before its answer (same created_at, different id)" "user,assistant" \
  "$AS_A select string_agg(role, ',' order by id) from (select role,id from public.assistant_messages where conversation_id='$CA' order by id limit 2) s"
is "the first two rows share a created_at — a timestamp could not have ordered them" 1 \
  "select count(distinct created_at) from (select created_at from public.assistant_messages where conversation_id='$CA' order by id limit 2) s"

# ─── A second person sees and touches nothing of A's ────────────────────────
is "B sees none of A's conversations" 0 "$AS_B select count(*) from public.assistant_conversations"
is "B sees none of A's messages" 0 "$AS_B select count(*) from public.assistant_messages"
refused "B cannot put a message in A's conversation (own user_id)" "row-level security" \
  "$AS_B insert into public.assistant_messages(conversation_id,user_id,role,content) values ('$CA','$B','user','x')"
refused "B cannot put a message in A's conversation (A's user_id)" "row-level security" \
  "$AS_B insert into public.assistant_messages(conversation_id,user_id,role,content) values ('$CA','$A','user','x')"
refused "A cannot write a message as B" "row-level security" \
  "$AS_A insert into public.assistant_messages(conversation_id,user_id,role,content) values ('$CA','$B','user','x')"
refused "B cannot create a conversation owned by A" "row-level security" \
  "$AS_B insert into public.assistant_conversations(user_id) values ('$A')"
# psql -qtA hides command tags, so rows touched are counted with RETURNING.
is "B's update of A's message touches 0 rows" 0 \
  "$AS_B with u as (update public.assistant_messages set content='tampered' where conversation_id='$CA' returning 1) select count(*) from u"
is "…and A's text is intact" "hello" "select content from public.assistant_messages where client_id='$M1'"
refused "A cannot move a message into B's conversation / hand it to B" "row-level security" \
  "$AS_A update public.assistant_messages set user_id='$B' where client_id='$M1'"
is "B's delete of A's rows removes 0" 0 \
  "$AS_B with d as (delete from public.assistant_messages where conversation_id='$CA' returning 1) select count(*) from d"
is "B's delete of A's conversation removes 0" 0 \
  "$AS_B with d as (delete from public.assistant_conversations where id='$CA' returning 1) select count(*) from d"
is "A's four messages are still there" 4 "select count(*) from public.assistant_messages where conversation_id='$CA'"

# ─── Nobody holding only the anon key ───────────────────────────────────────
is "anon sees nothing" 0 "$AS_ANON select count(*) from public.assistant_messages"
refused "anon cannot insert a conversation" "row-level security" \
  "$AS_ANON insert into public.assistant_conversations(user_id) values ('$A')"

# ─── The check constraints refuse bad rows, with the reason ─────────────────
refused "an unknown role is refused" "assistant_messages_role_check" \
  "insert into public.assistant_messages(conversation_id,user_id,role) values ('$CA','$A','system')"
refused "an unknown status is refused" "assistant_messages_status_check" \
  "insert into public.assistant_messages(conversation_id,user_id,role,status) values ('$CA','$A','user','pending')"
refused "an unknown tool_state is refused" "assistant_messages_tool_state_check" \
  "insert into public.assistant_messages(conversation_id,user_id,role,tool,tool_state) values ('$CA','$A','tool','x','spinning')"
refused "a tool row with no tool name is refused" "assistant_messages_tool_has_a_name" \
  "insert into public.assistant_messages(conversation_id,user_id,role) values ('$CA','$A','tool')"
refused "an unknown provider is refused" "assistant_conversations_provider_check" \
  "insert into public.assistant_conversations(user_id,provider) values ('$A','openai')"
refused "a message needs a conversation that exists" "foreign key" \
  "insert into public.assistant_messages(conversation_id,user_id,role) values (gen_random_uuid(),'$A','user')"

# ─── A retried insert lands on one row ──────────────────────────────────────
refused "the same client_id twice in one conversation is refused" "assistant_messages_client_uniq" \
  "insert into public.assistant_messages(conversation_id,user_id,client_id,role,content) values ('$CA','$A','$M1','user','again')"
q -c "insert into public.assistant_messages(conversation_id,user_id,client_id,role,content) values ('$CA','$A','$M1','user','again') on conflict (conversation_id, client_id) do nothing" >/dev/null 2>&1
is "…and an upsert of it (naming just the columns, as PostgREST must) leaves exactly one" 1 "select count(*) from public.assistant_messages where client_id='$M1'"
q >/dev/null -c "insert into public.assistant_conversations(id,user_id) values ('$CB','$B')"
allowed "the same client_id in ANOTHER conversation is fine" \
  "insert into public.assistant_messages(conversation_id,user_id,client_id,role,content) values ('$CB','$B','$M1','user','mine')"
allowed "rows with no client_id never collide" \
  "insert into public.assistant_messages(conversation_id,user_id,role,content) values ('$CB','$B','user','a'),('$CB','$B','user','b')"

# ─── updated_at moves with activity ─────────────────────────────────────────
q >/dev/null -c "update public.assistant_conversations set updated_at = now() - interval '1 hour' where id='$CA'"
q >/dev/null -c "$AS_A update public.assistant_messages set content='edited' where client_id='$M1' and conversation_id='$CA'"
is "a message update bumps its conversation's updated_at" t \
  "select updated_at > now() - interval '1 minute' from public.assistant_conversations where id='$CA'"
is "…and the message's own updated_at" t \
  "select updated_at >= created_at from public.assistant_messages where client_id='$M1' and conversation_id='$CA'"

# ─── 20260043: the lock, the claim, the parked call ─────────────────────────
q >/dev/null -c "insert into public.assistant_conversations(id,user_id) values ('dddddddd-0000-0000-0000-000000000001','$A')"
D1=dddddddd-0000-0000-0000-000000000001
allowed "A starts a streaming answer" "$AS_A insert into public.assistant_messages(conversation_id,user_id,role,status) values ('$D1','$A','assistant','streaming')"
refused "a SECOND streaming answer in the same conversation is refused (the lock)" "assistant_one_streaming" \
  "$AS_A insert into public.assistant_messages(conversation_id,user_id,role,status) values ('$D1','$A','assistant','streaming')"
allowed "…after the first completes, the next may start" \
  "$AS_A update public.assistant_messages set status='complete' where conversation_id='$D1' and status='streaming'; insert into public.assistant_messages(conversation_id,user_id,role,status) values ('$D1','$A','assistant','streaming')"
allowed "a tool call is parked with its id and input" \
  "$AS_A insert into public.assistant_messages(conversation_id,user_id,role,tool,tool_state,tool_use_id,tool_input) values ('$D1','$A','tool','list_habits','running','toolu_1','{\"a\":1}')"
refused "the same tool_use id twice is refused" "assistant_tool_use_uniq" \
  "$AS_A insert into public.assistant_messages(conversation_id,user_id,role,tool,tool_state,tool_use_id) values ('$D1','$A','tool','list_habits','running','toolu_1')"
is "device one claims it" 1 \
  "$AS_A with c as (update public.assistant_messages set claimed_by='dev1', claimed_at=now() where tool_use_id='toolu_1' and (claimed_by is null or claimed_at < now() - interval '2 minutes') returning 1) select count(*) from c"
is "device two cannot claim it while the claim is fresh" 0 \
  "$AS_A with c as (update public.assistant_messages set claimed_by='dev2', claimed_at=now() where tool_use_id='toolu_1' and (claimed_by is null or claimed_at < now() - interval '2 minutes') returning 1) select count(*) from c"
q >/dev/null -c "update public.assistant_messages set claimed_at = now() - interval '3 minutes' where tool_use_id='toolu_1'"
is "…but can once the claim is three minutes old" 1 \
  "$AS_A with c as (update public.assistant_messages set claimed_by='dev2', claimed_at=now() where tool_use_id='toolu_1' and (claimed_by is null or claimed_at < now() - interval '2 minutes') returning 1) select count(*) from c"
is "B cannot read A's turn state or tool input" 0 "$AS_B select count(*) from public.assistant_messages where tool_use_id='toolu_1'"
allowed "the conversation can hold the in-flight turn, and clear it" \
  "$AS_A update public.assistant_conversations set turn='{\"msgs\":[]}' where id='$D1'; update public.assistant_conversations set turn=null where id='$D1'"

# ─── 20260044: what an answer cost ──────────────────────────────────────────
q -f "$SQL3" >/dev/null 2>&1 && ok "20260044 applies" 1 || ok "20260044 applies" 0
q -f "$SQL3" >/dev/null 2>&1 && ok "20260044 second apply exits 0" 1 || ok "20260044 second apply exits 0" 0
q >/dev/null -c "insert into public.assistant_conversations(id,user_id) values ('eeeeeeee-0000-0000-0000-000000000001','$A') on conflict do nothing"
E1=eeeeeeee-0000-0000-0000-000000000001
allowed "A records what an answer cost, on the answer" "$AS_A insert into public.assistant_messages(conversation_id,user_id,role,usage) values ('$E1','$A','assistant','{\"input\":1200,\"output\":300,\"model\":\"m\",\"provider\":\"groq\"}'), ('$E1','$A','assistant','{\"input\":800,\"output\":100,\"model\":\"m\",\"provider\":\"groq\"}')"
allowed "a row with no usage is still fine (old rows, the user's own messages)" "$AS_A insert into public.assistant_messages(conversation_id,user_id,role,content) values ('$E1','$A','user','q')"
is "the month's tokens are one sum over the rows that have a usage" 2400 \
  "$AS_A select sum((usage->>'input')::bigint + (usage->>'output')::bigint) from public.assistant_messages where user_id='$A' and usage is not null and created_at >= date_trunc('month', now())"
is "B cannot see A's usage" 0 "$AS_B select count(*) from public.assistant_messages where usage is not null and user_id='$A'"
is "the partial index for that query exists" 1 "select count(*) from pg_indexes where indexname='assistant_messages_usage_idx' and indexdef ilike '%where%usage is not null%'"
is "CONTROL: last month's usage is outside that range" 0 \
  "select count(*) from (select 1 from public.assistant_messages where usage is not null and created_at >= date_trunc('month', now() + interval '1 month')) x"

# ─── Archive, then forget ───────────────────────────────────────────────────
allowed "A archives their conversation" "$AS_A update public.assistant_conversations set archived_at = now() where id='$CA'"
is "an archived conversation is out of the live list's index predicate" 0 \
  "select count(*) from public.assistant_conversations where id='$CA' and archived_at is null"
is "…but its messages are kept" 4 "select count(*) from public.assistant_messages where conversation_id='$CA'"
allowed "A deletes it for good" "$AS_A delete from public.assistant_conversations where id='$CA'"
is "deleting a conversation takes its messages" 0 "select count(*) from public.assistant_messages where conversation_id='$CA'"
q >/dev/null -c "delete from auth.users where id='$B'"
is "deleting a user takes their conversations and messages" 0 \
  "select (select count(*) from public.assistant_conversations where user_id='$B') + (select count(*) from public.assistant_messages where user_id='$B')"

# ─── CONTROL — remove the defence and the same reads succeed ────────────────
q >/dev/null -c "insert into auth.users values ('$B') on conflict do nothing; insert into public.assistant_conversations(id,user_id) values ('$CA','$A') on conflict do nothing; insert into public.assistant_messages(conversation_id,user_id,role,content) values ('$CA','$A','user','secret')"
is "CONTROL (RLS on): B sees 0 of A's rows" 0 "$AS_B select count(*) from public.assistant_messages where user_id='$A'"
q >/dev/null -c "alter table public.assistant_messages disable row level security"
got=$(q -c "$AS_B select count(*) from public.assistant_messages where user_id='$A'" 2>&1 | tail -1)
[ "$got" -ge 1 ] 2>/dev/null && ok "CONTROL (RLS off): the same read by B returns A's rows — the 0s above were RLS's doing" 1 \
  || ok "CONTROL (RLS off): the same read by B returns A's rows" 0 "got '$got'"
q >/dev/null -c "alter table public.assistant_messages enable row level security"

[ "$code" = 0 ] && echo "ALL PASSED" || echo "SOME FAILED"
exit $code

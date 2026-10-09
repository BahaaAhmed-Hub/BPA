#!/usr/bin/env bash
# 20260024_booking.sql, applied to a throwaway Postgres and then argued with.
#
# The claims worth proving are the ones a reader of the file has to take on
# trust: that the slot index really is the race guard, that a second apply is a
# no-op, that nobody but the owner can see a plan or a booking, and that the
# rate-limit ledger is invisible to everybody holding an anon key.
#
# Every refusal is asserted **with the reason**. A statement that fails for the
# wrong reason — a missing row, a null auth.uid(), a foreign key — passes a
# bare "this was refused" test while proving nothing, which is how the first
# version of this file reported eight PASSes about an empty database.
#
# Usage:  scripts/booking-sql-holds.sh <socket-dir> [port]
# The caller owns the cluster; this script only talks to it.
set -uo pipefail

DIR="${1:?socket directory of a running postgres}"
PORT="${2:-5599}"
SQL="$(cd "$(dirname "$0")/.." && pwd)/supabase/migrations/20260024_booking.sql"

q() { psql -h "$DIR" -p "$PORT" -U bpa -d postgres -v ON_ERROR_STOP=1 -qtA "$@"; }

code=0
ok() { # ok <name> <0|1> [extra]
  if [ "$2" = 1 ]; then echo "PASS  $1${3:+  $3}"
  else echo "*** FAIL ***  $1${3:+  $3}"; code=1; fi
}

# refused <name> <error-pattern> <sql>  — fails unless the statement is
# refused AND the message matches, so the reason is part of the claim.
refused() {
  local name=$1 want=$2 sql=$3 out
  out=$(q -c "$sql" 2>&1)
  if [ $? = 0 ]; then ok "$name" 0 "it was allowed"
  elif echo "$out" | grep -qi -- "$want"; then ok "$name" 1
  else ok "$name" 0 "refused, but for: $(echo "$out" | grep -i '^ERROR' | head -1 | cut -c1-90)"; fi
}

# allowed <name> <sql>
allowed() {
  local name=$1 sql=$2 out
  out=$(q -c "$sql" 2>&1)
  if [ $? = 0 ]; then ok "$name" 1
  else ok "$name" 0 "$(echo "$out" | grep -i '^ERROR' | head -1 | cut -c1-90)"; fi
}

A=11111111-1111-1111-1111-111111111111
B=22222222-2222-2222-2222-222222222222
P1=33333333-3333-3333-3333-333333333333
P2=44444444-4444-4444-4444-444444444444
P3=55555555-5555-5555-5555-555555555555

# A session-level `set`, never `set local`: each psql call is its own session
# and SET LOCAL outside a transaction block is a no-op with a warning — which
# left auth.uid() null and every policy correctly refusing everything.
AS_A="set role authenticated; set \"test.uid\" = '$A';"
AS_B="set role authenticated; set \"test.uid\" = '$B';"

# ─── The world the migration expects ────────────────────────────────────────
# auth.users, auth.uid() and has_module() are Supabase's, stubbed. has_module
# answers from a setting so the module gate can be switched inside one session;
# the real resolver is verified by 20260021's own run.
q >/dev/null <<SQL
drop table if exists public.booking_hits, public.bookings, public.meeting_plans,
                     public.booking_windows, public.booking_profile cascade;
drop schema if exists auth cascade;
create schema auth;
create table auth.users (id uuid primary key);
insert into auth.users values ('$A'), ('$B');

create or replace function auth.uid() returns uuid language sql stable as \$\$
  select nullif(current_setting('test.uid', true), '')::uuid
\$\$;

create or replace function public.has_module(uid uuid, m text) returns boolean
language sql stable as \$\$
  select coalesce(nullif(current_setting('test.module', true), ''), 'on') = 'on'
\$\$;

do \$\$ begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'anon')          then create role anon;          end if;
end \$\$;
SQL

# ─── Apply, and apply again ─────────────────────────────────────────────────
q -f "$SQL" >/dev/null 2>&1 && ok "it applies" 1 || ok "it applies" 0
q -f "$SQL" >/dev/null 2>&1 && ok "a second apply exits 0 — editing the file is how it is corrected" 1 \
  || ok "a second apply exits 0 — editing the file is how it is corrected" 0

pols=$(q -c "select count(*) from pg_policies where schemaname='public' and tablename in ('booking_profile','booking_windows','meeting_plans','bookings')")
ok "four policies, not eight" "$([ "$pols" = 4 ] && echo 1 || echo 0)" "$pols"
hits=$(q -c "select count(*) from pg_policies where schemaname='public' and tablename='booking_hits'")
ok "the rate-limit ledger has no policy at all" "$([ "$hits" = 0 ] && echo 1 || echo 0)" "$hits"
rls=$(q -c "select count(*) from pg_class where relname in ('booking_profile','booking_windows','meeting_plans','bookings','booking_hits') and relrowsecurity")
ok "RLS is on for all five" "$([ "$rls" = 5 ] && echo 1 || echo 0)" "$rls"

# Supabase grants its two roles table privileges and lets RLS decide; the repo
# has no grant of its own, so the test has to stand them up to exercise policies.
q >/dev/null <<'SQL'
grant usage on schema public to authenticated, anon;
grant select, insert, update, delete on all tables in schema public to authenticated, anon;
grant usage, select on all sequences in schema public to authenticated, anon;
SQL

refused "an hour that ends before it starts is refused" "booking_windows_check" \
  "insert into public.booking_windows (user_id, on_date, start_min, end_min) values ('$A','2026-10-13',600,540)"

# ─── The owner, with the module on ──────────────────────────────────────────
allowed "the owner opens a page, some hours and two plans" \
  "$AS_A
   insert into public.booking_profile (user_id, handle, display_name, timezone) values ('$A','bahaa','Bahaa','Africa/Cairo');
   insert into public.booking_windows (user_id, on_date, start_min, end_min, repeat)
     values ('$A','2026-10-13',540,1020,'{\"kind\":\"weekly\",\"interval\":1}');
   insert into public.meeting_plans (id, user_id, slug, title, duration_minutes) values ('$P1','$A','intro','Intro call',30);
   insert into public.meeting_plans (id, user_id, slug, title, duration_minutes) values ('$P2','$A','demo','Teradix demo',45)"

mine=$(q -c "$AS_A select count(*) from public.meeting_plans")
ok "the owner reads their own plans" "$([ "$mine" = 2 ] && echo 1 || echo 0)" "$mine"
hrs=$(q -c "$AS_A select count(*) from public.booking_windows")
ok "and the hours they opened" "$([ "$hrs" = 1 ] && echo 1 || echo 0)" "$hrs"

# ─── Somebody else ──────────────────────────────────────────────────────────
theirs=$(q -c "$AS_B select count(*) from public.meeting_plans")
ok "another account sees none of them" "$([ "$theirs" = 0 ] && echo 1 || echo 0)" "$theirs"
win=$(q -c "$AS_B select count(*) from public.booking_windows")
ok "nor the hours they were opened in" "$([ "$win" = 0 ] && echo 1 || echo 0)" "$win"
refused "nor may they write a plan onto somebody else" "row-level security" \
  "$AS_B insert into public.meeting_plans (user_id, slug, title) values ('$A','sneak','Mine now')"

# ─── Signed out ─────────────────────────────────────────────────────────────
out=$(q -c "set role anon; select count(*) from public.meeting_plans")
ok "an anon key reads nothing — the public page cannot be the boundary" "$([ "$out" = 0 ] && echo 1 || echo 0)" "$out"
led=$(q -c "set role anon; select count(*) from public.booking_hits")
ok "and the rate-limit ledger is invisible to it" "$([ "$led" = 0 ] && echo 1 || echo 0)" "$led"
refused "nor can it be filled up from outside" "row-level security" \
  "set role anon; insert into public.booking_hits (ip_hash) values ('deadbeef')"

# ─── The module gate ────────────────────────────────────────────────────────
off=$(q -c "$AS_A set \"test.module\" = 'off'; select count(*) from public.meeting_plans")
ok "calendar withdrawn takes booking with it" "$([ "$off" = 0 ] && echo 1 || echo 0)" "$off"

# ─── The race guard ─────────────────────────────────────────────────────────
allowed "the first person takes 11:00" \
  "$AS_A insert into public.bookings (plan_id, user_id, start_at, end_at, invitee_name, invitee_email)
         values ('$P1','$A','2026-10-13T11:00:00Z','2026-10-13T11:30:00Z','Omar','omar@example.com')"

refused "two people cannot take one slot" "bookings_slot_idx" \
  "$AS_A insert into public.bookings (plan_id, user_id, start_at, end_at, invitee_name, invitee_email)
         values ('$P1','$A','2026-10-13T11:00:00Z','2026-10-13T11:30:00Z','Sara','sara@example.com')"

refused "nor can a second plan sell the same hour" "bookings_slot_idx" \
  "$AS_A insert into public.bookings (plan_id, user_id, start_at, end_at, invitee_name, invitee_email)
         values ('$P2','$A','2026-10-13T11:00:00Z','2026-10-13T11:45:00Z','Sara','sara@example.com')"

q -c "$AS_A update public.bookings set status='cancelled', cancelled_at=now() where invitee_name='Omar'" >/dev/null
allowed "a cancellation frees the hour" \
  "$AS_A insert into public.bookings (plan_id, user_id, start_at, end_at, invitee_name, invitee_email)
         values ('$P1','$A','2026-10-13T11:00:00Z','2026-10-13T11:30:00Z','Sara','sara@example.com')"

allowed "and it says nothing about anybody else's calendar" \
  "$AS_B insert into public.meeting_plans (id, user_id, slug, title) values ('$P3','$B','intro','Intro');
   $AS_B insert into public.bookings (plan_id, user_id, start_at, end_at, invitee_name, invitee_email)
         values ('$P3','$B','2026-10-13T11:00:00Z','2026-10-13T11:30:00Z','Sara','sara@example.com')"

refused "a handle cannot be taken twice" "booking_profile_handle_key" \
  "$AS_B insert into public.booking_profile (user_id, handle) values ('$B','bahaa')"

refused "a plan's slug is one per page" "meeting_plans_user_id_slug_key" \
  "$AS_A insert into public.meeting_plans (user_id, slug, title) values ('$A','intro','Another intro')"

exit $code

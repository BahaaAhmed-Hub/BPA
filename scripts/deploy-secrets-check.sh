#!/usr/bin/env bash
# ─── What the deploy actually asks Supabase to set ───────────────────────────
#
# `supabase secrets set X=` sets X to the empty string. The deploy step used to
# interpolate `${{ secrets.X }}` straight into the command, and GitHub
# substitutes an empty string for a secret that does not exist — so a secret
# missing from GitHub silently BLANKED the live value on the next deploy. That
# is a worse failure than a stale key: the bots lose a working credential and
# nothing says so.
#
# This lifts the real script out of the workflow — no second copy to drift —
# and runs it against a stub `supabase`, asserting what it would have been
# asked to do. Run it after touching the secret list.
#
#   bash scripts/deploy-secrets-check.sh
set -uo pipefail
cd "$(dirname "$0")/.."

WORK=$(mktemp -d); trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/stub"
printf '#!/bin/bash\necho "$@" >> "$CALLS"\n' > "$WORK/stub/supabase"
chmod +x "$WORK/stub/supabase"

python3 - "$WORK/step.sh" <<'PY' || { echo "could not lift the step (needs python3 + pyyaml)"; exit 1; }
import sys, yaml
d = yaml.safe_load(open('.github/workflows/deploy-functions.yml'))
step = next(s for s in d['jobs']['deploy']['steps'] if s.get('name') == 'Set Edge Function secrets')
open(sys.argv[1], 'w').write(step['run'])
PY

fail=0
call () {
  export CALLS="$WORK/calls"; : > "$CALLS"
  env -i PATH="$WORK/stub:/usr/bin:/bin" CALLS="$CALLS" SUPABASE_PROJECT_REF=ref123 \
    "$@" bash "$WORK/step.sh" >/dev/null 2>&1
  cat "$CALLS"
}
ok () {
  if [ "$2" = "$3" ]; then echo "PASS  $1"
  else echo "*** FAIL ***  $1"; echo "        want: $3"; echo "        got:  $2"; fail=1; fi
}

ok "all three are asserted when all three are present" \
  "$(call GOOGLE_CLIENT_ID=gid GOOGLE_CLIENT_SECRET=gsec ANTHROPIC_API_KEY=sk-ant-NEW)" \
  "secrets set GOOGLE_CLIENT_ID=gid GOOGLE_CLIENT_SECRET=gsec ANTHROPIC_API_KEY=sk-ant-NEW --project-ref ref123"

ok "a missing ANTHROPIC_API_KEY is never sent as empty" \
  "$(call GOOGLE_CLIENT_ID=gid GOOGLE_CLIENT_SECRET=gsec)" \
  "secrets set GOOGLE_CLIENT_ID=gid GOOGLE_CLIENT_SECRET=gsec --project-ref ref123"

ok "a missing Google pair is never sent as empty either" \
  "$(call ANTHROPIC_API_KEY=sk-ant-NEW)" \
  "secrets set ANTHROPIC_API_KEY=sk-ant-NEW --project-ref ref123"

ok "with nothing to assert, supabase is not called at all" "$(call)" ""

ok "a value is not word-split or globbed on its way through" \
  "$(call ANTHROPIC_API_KEY='sk-ant with $pace and *star')" \
  'secrets set ANTHROPIC_API_KEY=sk-ant with $pace and *star --project-ref ref123'

logged=$(env -i PATH="$WORK/stub:/usr/bin:/bin" CALLS=/dev/null SUPABASE_PROJECT_REF=ref123 \
  ANTHROPIC_API_KEY=sk-ant-SECRETVALUE bash "$WORK/step.sh" 2>&1)
if grep -q SECRETVALUE <<<"$logged"; then
  echo "*** FAIL ***  a value is echoed into the run log"; fail=1
else
  echo "PASS  no value is echoed into the run log"
fi

[ $fail -eq 0 ] && echo "── the deploy can add a secret and can never blank one"
exit $fail

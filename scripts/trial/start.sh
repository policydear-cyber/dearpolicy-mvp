#!/usr/bin/env bash
# DearPolicy hands-on TRIAL (GitHub Codespace). Runs on every Codespace start (.devcontainer/devcontainer.json
# postStartCommand); safe to run again by hand: bash scripts/trial/start.sh
# Local Postgres 17 + pgvector, schema, a cached `next build`, then the trial server (e2e/support/trial-server.ts) on
# 0.0.0.0:3000 in the background. The OpenAI key comes ONLY from the Codespaces secret OPENAI_TEST_API_KEY and is
# handed to the server process alone; it is never printed. Without it the trial starts in PREFLIGHT (uploads work,
# every model call is refused). Never `set -x` here.
set -euo pipefail
cd "$(dirname "$0")/../.."
mkdir -p .trial
log() { printf '\n[trial] %s\n' "$*"; }

if [ "${CODESPACES:-}" != "true" ]; then
  echo "[trial] refused: this script runs only inside a GitHub Codespace (CODESPACES=true)." >&2; exit 1
fi
export TRIAL_MODE=1 NODE_ENV=test NEXT_TELEMETRY_DISABLED=1
export DATABASE_URL="${TRIAL_DATABASE_URL:-postgres://postgres:postgres@localhost:5432/dearpolicy_trial}"
# The trial spends from the same US$0.50 exercise allowance as the recorded live runs: the cap is the smaller of
# TRIAL_CAP_USD (default 0.25) and what docs/rag-migration/live/LEDGER.json leaves of exercise_cap_usd.
TRIAL_CAP_USD="$(node -e '
const l=require("./docs/rag-migration/live/LEDGER.json");
const spent=(l.runs||[]).reduce((a,r)=>a+Number(r.spent_usd||0)+Number(r.reserved_unsettled_usd||0),0);
const left=Math.floor((Number(l.exercise_cap_usd)-spent)*1e4)/1e4;
const want=Number(process.env.TRIAL_CAP_USD||"0.25");
process.stdout.write(String(Math.min(want,left)));')"
if ! node -e 'process.exit(Number(process.argv[1])>0?0:1)' "$TRIAL_CAP_USD"; then
  echo "[trial] refused: the US\$0.50 exercise allowance is used up (docs/rag-migration/live/LEDGER.json)." >&2; exit 1
fi
export TRIAL_CAP_USD
export CHAT_MODEL=openai:gpt-6-luna JUDGEMENT_MODEL=openai:gpt-6-luna NARRATION_MODEL=openai:gpt-6-luna READING_MODEL=openai:gpt-6-luna
export DEARPOLICY_RAG_LOOP_RUN_MAX_USD="$TRIAL_CAP_USD" DEARPOLICY_RAG_LOOP_REQUIRE_PRICE=1
unset OPENAI_BASE_URL ANTHROPIC_API_KEY GEMINI_API_KEY GROQ_API_KEY PINECONE_API_KEY VIRUSTOTAL_API_KEY DEARPOLICY_DETERMINISTIC_MODEL VERCEL VERCEL_ENV || true

log "1/4 database"
if ! pg_isready -q -h localhost -p 5432; then
  (sudo -n pg_ctlcluster 17 main start 2>/dev/null || pg_ctlcluster 17 main start 2>/dev/null || sudo -n service postgresql start) >/dev/null
  for _ in $(seq 1 30); do pg_isready -q -h localhost -p 5432 && break; sleep 1; done
fi
db=$(node -e 'process.stdout.write(new URL(process.env.DATABASE_URL).pathname.slice(1))')
if ! PGPASSWORD=postgres psql -h localhost -U postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$db'" | grep -q 1; then
  PGPASSWORD=postgres psql -h localhost -U postgres -qc "CREATE DATABASE $db"
fi
PGPASSWORD=postgres psql -h localhost -U postgres -d "$db" -qc "CREATE EXTENSION IF NOT EXISTS vector; CREATE EXTENSION IF NOT EXISTS pgcrypto;"
npm run -s db:setup

log "2/4 build (cached while the code is unchanged)"
stamp="$(git rev-parse HEAD 2>/dev/null)-$( (git status --porcelain --untracked-files=no -- . ':!.trial' 2>/dev/null || true) | sha1sum | cut -c1-12)"
if [ ! -f .next/BUILD_ID ] || [ "$(cat .trial/build-stamp 2>/dev/null)" != "$stamp" ]; then
  NODE_OPTIONS=--max-old-space-size="${TRIAL_BUILD_HEAP_MB:-4096}" npx next build > .trial/build.log 2>&1 || { tail -40 .trial/build.log; echo "[trial] next build failed (.trial/build.log)" >&2; exit 1; }
  echo "$stamp" > .trial/build-stamp
else
  echo "[trial] reusing the existing build ($stamp)"
fi

log "3/4 server"
if [ -f .trial/server.pid ] && kill -0 "$(cat .trial/server.pid)" 2>/dev/null; then kill "$(cat .trial/server.pid)" 2>/dev/null || true; sleep 2; fi
if [ -n "${OPENAI_TEST_API_KEY:-}" ]; then runkey="$OPENAI_TEST_API_KEY"; mode="LIVE (the real model, gpt-6-luna)"; else runkey="preflight-no-key-set"; mode="PREFLIGHT: no OPENAI_TEST_API_KEY Codespaces secret -- uploads and reading of text work, every model call is refused"; fi
# The key reaches the server process only (its own environment); this shell drops it at once.
nohup env -u OPENAI_TEST_API_KEY OPENAI_API_KEY="$runkey" PORT=3000 node --max-old-space-size=2048 --import tsx e2e/support/trial-server.ts > .trial/server.log 2>&1 &
echo $! > .trial/server.pid
runkey=""
for _ in $(seq 1 180); do grep -q "trial server on" .trial/server.log 2>/dev/null && break; if ! kill -0 "$(cat .trial/server.pid)" 2>/dev/null; then tail -20 .trial/server.log; echo "[trial] the server stopped (.trial/server.log)" >&2; exit 1; fi; sleep 1; done
grep -q "trial server on" .trial/server.log || { tail -20 .trial/server.log; echo "[trial] the server did not start in 180 s" >&2; exit 1; }

log "4/4 ready"
url="http://localhost:3000"
if [ -n "${CODESPACE_NAME:-}" ] && [ -n "${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-}" ]; then url="https://${CODESPACE_NAME}-3000.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}"; fi
usage=$(curl -sf http://localhost:3000/__trial/usage || echo '{}')
node -e 'const u=JSON.parse(process.argv[1]||"{}");console.log(`[trial] mode: ${process.argv[2]}\n[trial] trial budget: US$${(u.spentUsd??0).toFixed(4)} spent of US$${u.capUsd??"?"} -- US$${(u.remainingUsd??0).toFixed(4)} left (kept in .trial/ledger.json across restarts)`)' "$usage" "$mode"
cat <<EOF

  DearPolicy trial is running:  $url
  (Spend so far: $url/__trial/usage)

  Open the link above (it is private to your GitHub account). You are already signed in as a made-up household:
  first add the people in it on the Family page, then upload the sample PDFs on the Policies page and wait until each
  says it is ready, then ask questions on the Chat page. Everything is test data kept inside this Codespace; the
  answers come from the real model and each one costs a little of the trial budget above. When you are done, stop the
  Codespace (GitHub -> Codespaces -> ... -> Stop codespace). Full steps: docs/trial/TRIAL.md

EOF

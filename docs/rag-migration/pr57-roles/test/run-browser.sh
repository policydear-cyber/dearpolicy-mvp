#!/usr/bin/env bash
# Reliable-chat browser specs, one at a time, on the checked-out tree. Local PostgreSQL (fresh DB per run), scripted
# model, synthetic households only, no model call. Usage: OUT=<dir> bash run-browser.sh  (run from the worktree root)
set -u
OUT=${OUT:?set OUT}; mkdir -p "$OUT"
export DATABASE_URL=postgresql://dearpolicy:dearpolicy@localhost:5432/dearpolicy DATABASE_SSL=off E2E_RUN_ID=local$$ \
  STORAGE_DRIVER=local LOCAL_STORAGE_DIR=$PWD/.e2e-storage MALWARE_SCANNER_PROVIDER=virustotal \
  VIRUSTOTAL_API_KEY=synthetic-e2e-virustotal-key VIRUSTOTAL_API_BASE_URL=http://127.0.0.1:4010/vt \
  DEARPOLICY_DETERMINISTIC_MODEL=synthetic-e2e NEXT_TELEMETRY_DISABLED=1 DEARPOLICY_RAG_LOOP=1 E2E_RAG2_NEXT=start \
  E2E_RAG2_BASE_URL=http://localhost:3300 E2E_CHROMIUM_PATH=/opt/pw-browsers/chromium
su postgres -c "psql -qc 'DROP DATABASE IF EXISTS dearpolicy;' -c 'CREATE DATABASE dearpolicy OWNER dearpolicy;'"
node --import tsx e2e/support/apply-schema.ts > "$OUT/apply-schema.log" 2>&1 || { echo "schema failed"; exit 1; }
env -u DATABASE_SSL npx next build > "$OUT/next-build.log" 2>&1; echo "next build exit $?" >> "$OUT/next-build.log"
printf "spec\thousehold\texit\tpassed\tfailed\tsummary\n" > "$OUT/summary.tsv"
for pair in ${PAIRS:-reliable-chat:tan reliable-chat-booklet:booklet reliable-chat-actuallib:actuallib reliable-chat-fracture:fracture reliable-chat-deathjourney:deathjourney reliable-chat-dj-live-3:deathvalues}; do
  cfg=${pair%%:*}; hh=${pair##*:}
  pkill -f "e2e/support/rag2-loop-server.ts"; sleep 2
  node --import tsx e2e/support/seed-rag2-stress-report.ts --household "$hh" > "$OUT/$cfg.seed.log" 2>&1
  E2E_RAG2_HOUSEHOLD=$hh PORT=3300 NODE_ENV=test nohup node --import tsx e2e/support/rag2-loop-server.ts > "$OUT/$cfg.server.log" 2>&1 &
  for i in $(seq 1 120); do curl -sf -o /dev/null http://localhost:3300/api/health && break; sleep 2; done
  timeout 1800 npx playwright test -c e2e/support/playwright.$cfg.config.ts > "$OUT/$cfg.log" 2>&1; e=$?
  p=$(grep -oE "[0-9]+ passed" "$OUT/$cfg.log" | tail -1); f=$(grep -oE "[0-9]+ failed" "$OUT/$cfg.log" | tail -1)
  printf "%s\t%s\t%s\t%s\t%s\t%s\n" "$cfg" "$hh" "$e" "${p:-0 passed}" "${f:-0 failed}" "$(grep -v '^\s*$' "$OUT/$cfg.log" | tail -1 | cut -c1-140)" >> "$OUT/summary.tsv"
done
pkill -f "e2e/support/rag2-loop-server.ts"
git status --short > "$OUT/worktree-after.txt"

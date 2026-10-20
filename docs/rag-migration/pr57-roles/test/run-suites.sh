#!/usr/bin/env bash
# Runs the handoff's suite list one at a time on the checked-out tree and writes, per suite,
# exit code + PASS/FAIL/ok lines to $OUT/<suite>.log and a summary TSV. No model call, no spend.
# Usage: OUT=<dir> bash docs/rag-migration/pr57-roles/test/run-suites.sh
set -u
OUT=${OUT:?set OUT}
mkdir -p "$OUT"
SUITES="reliable-chat:slice-test reliable-chat:live-regressions-test reliable-chat:death-journey-test reliable-chat:cache-compaction-test reliable-chat:death-live-repairs-test reliable-chat:dj-live-3-replay-test reliable-chat:death-cause-test reliable-chat:death-applicability-test reliable-chat:cases-test reliable-chat:conflicts-test reliable-chat:booklet-test reliable-chat:cda-recorded-test reliable-chat:structured-answers-test reliable-chat:benefit-records-test reliable-chat:applicability-test reliable-chat:stage3-test reliable-chat:absence-scope-test reliable-chat:fx-repairs-test rag2:loop-test rag2:conv-test rag2:fix-test rag2:adversarial-test rag2:conv2-test rag2:conv3-test rag2:conv4-test rag2:conv5-test rag2:conv6-test rag2:conv7-test rag2:facts-test rag2:scenario-test rag2:stress-test rag2:binding-test rag2:live-verify-test rag2:pr50-regressions rag2:calc-boundary-test rag2:calc-ingested-test rag2:calc-test rag2:deletion-semantics-test rag2:gaps-test rag2:presentation-test rag2:release-test rag2:roster-test rag2:scenario-replay-test rag2:tools-test rag2:units-test claims:indicative-estimate-test claims:injury-adversarial-test security:live-chat-monetary-boundary-test v1:chat-contract-test v11:answer-test v11:claims-test v11:customer-screens-test rag2:s52-replay security:env-contract-test"
printf "suite\texit\tpass\tfail\tsummary\n" > "$OUT/summary.tsv"
for s in $SUITES; do
  timeout 900 npm run -s "$s" > "$OUT/$s.log" 2>&1; e=$?
  p=$(grep -cE "^(PASS|  ok|ok) " "$OUT/$s.log"); f=$(grep -cE "^ *FAIL " "$OUT/$s.log")
  printf "%s\t%s\t%s\t%s\t%s\n" "$s" "$e" "$p" "$f" "$(grep -v '^\s*$' "$OUT/$s.log" | tail -1 | cut -c1-140)" >> "$OUT/summary.tsv"
done
for x in "scripts/reliable-chat-fracture-replay.ts" "scripts/rag2-live/fx-live-2-criteria-v2-regressions.ts" "scripts/rag2-live/fx-live-2-criteria-regressions.ts" "scripts/rag2-live/usefulness-check-regressions.ts"; do
  n=$(basename "$x" .ts); timeout 900 node --import tsx "$x" > "$OUT/$n.log" 2>&1; e=$?
  printf "%s\t%s\t%s\t%s\t%s\n" "$n" "$e" "$(grep -cE '^PASS ' "$OUT/$n.log")" "$(grep -cE '^ *FAIL ' "$OUT/$n.log")" "$(grep -v '^\s*$' "$OUT/$n.log" | tail -1 | cut -c1-140)" >> "$OUT/summary.tsv"
done
# Suites may rewrite tracked results files (e.g. scripts/full-household-e2e-last-result.json); record them, never commit them.
git status --short > "$OUT/worktree-after.txt"

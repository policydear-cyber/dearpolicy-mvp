#!/usr/bin/env bash
# CI only (.github/workflows/trial-startup.yml): runs INSIDE the trial dev container -- the image, postCreateCommand and
# postStartCommand a new Codespace uses -- after `devcontainer up`, with CODESPACES=true and a made-up CODESPACE_NAME.
# No key: the trial runs in PREFLIGHT (every model call refused, US$0). Checks what DC would do first:
#   1. the server started by postStartCommand is answering (it survived the lifecycle command), in preflight, with the
#      reserved allowance; 2. a POST from this Codespace's own forwarded address passes the app's CSRF check and one
#      from another site is refused; 3. the real pages in a real browser: add the household, upload the three sample
#      PDFs, one chat question gets an answer; 4. a restart (start.sh again, or --after-restart after the container was
#      stopped and started) reuses the build and keeps the household and the spend record.
set -euo pipefail
cd "$(dirname "$0")/../.."
fail() { echo "[startup-check] FAIL: $*" >&2; exit 1; }
ok() { echo "[startup-check] ok: $*"; }
mode="${1:-first}"
out="$PWD/e2e-results/trial-startup/$mode"; mkdir -p "$out"

for _ in $(seq 1 60); do curl -sf http://localhost:3000/__trial/usage > "$out/usage.json" 2>/dev/null && break; sleep 2; done
[ -s "$out/usage.json" ] || { tail -40 .trial/server.log 2>/dev/null || true; fail "the trial server is not answering on :3000 after postStartCommand"; }
node -e '
const u = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
const bad = [];
if (!/^preflight/.test(u.mode)) bad.push("mode " + u.mode);
if (u.capUsd !== 0.15) bad.push("cap " + u.capUsd);
if (u.spentUsd !== 0) bad.push("spent " + u.spentUsd);
if (process.argv[2] === "after-restart" && !(u.restarts >= 1)) bad.push("restarts " + u.restarts);
if (bad.length) { console.error(bad.join("; ")); process.exit(1); }
console.log(`[startup-check] ok: server answering: ${u.mode}; cap US$${u.capUsd}; spent US$${u.spentUsd}; restarts ${u.restarts}`);
' "$out/usage.json" "$mode" || fail "usage: $(cat "$out/usage.json")"
node -e 'const l=JSON.parse(require("fs").readFileSync(".trial/ledger.json","utf8")); if (l.allocationId!=="trial-codespace-1"||l.codespace!==process.env.CODESPACE_NAME) process.exit(1)' || fail ".trial/ledger.json is not bound to trial-codespace-1 and this Codespace"
ok ".trial/ledger.json bound to trial-codespace-1 and $CODESPACE_NAME"

pubhost="${CODESPACE_NAME}-3000.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}"
post() { curl -s -o /dev/null -w '%{http_code}' -X POST http://localhost:3000/api/family -H 'content-type: application/json' -H "x-forwarded-host: $pubhost" -H "origin: $1" -d '{}'; }
own=$(post "https://$pubhost"); foreign=$(post "https://evil.example.com")
[ "$own" != "403" ] || fail "a POST from this Codespace's own forwarded address was refused (403)"
[ "$foreign" = "403" ] || fail "a POST from another site was not refused (HTTP $foreign)"
ok "forwarded-address POST passes the CSRF check (HTTP $own); another site's POST is refused (HTTP $foreign)"

if [ "$mode" = "first" ]; then
  ( for _ in $(seq 1 1200); do if [ -f "$out/.processing-done" ]; then touch "$out/.dump-done"; break; fi; sleep 1; done ) &
  INGEST_LIVE_BASE=http://localhost:3000 INGEST_LIVE_OUT="$out" INGEST_LIVE_FIXTURE=scripts/ingest-live/fixture INGEST_LIVE_PREFLIGHT=1 \
    npx playwright test -c e2e/playwright.ingest-live.config.ts > "$out/browser.log" 2>&1 || { tail -40 "$out/browser.log"; fail "the browser journey (family, uploads, one chat question) failed"; }
  node -e '
const fs = require("fs"), d = process.argv[1];
const up = JSON.parse(fs.readFileSync(d + "/uploads.json", "utf8")), tr = JSON.parse(fs.readFileSync(d + "/transcript.json", "utf8"));
const m = JSON.parse(fs.readFileSync(d + "/members.json", "utf8"));
if (Object.keys(m).length !== 4) { console.error("members " + Object.keys(m).length); process.exit(1); }
if (up.length !== 3 || up.some((u) => !u.policyId)) { console.error("uploads " + JSON.stringify(up.map((u) => [u.file, u.finalStatus]))); process.exit(1); }
if (!tr.length || !(tr[0].answer || tr[0].error)) { console.error("no chat answer"); process.exit(1); }
console.log("[startup-check] ok: 4 people added; uploads " + up.map((u) => `${u.file}=${u.finalStatus}`).join(", ") + "; chat answered: " + JSON.stringify((tr[0].answer || tr[0].error).slice(0, 160)));
' "$out" || fail "journey results"
  bash scripts/trial/start.sh > "$out/restart.log" 2>&1 || { tail -30 "$out/restart.log"; fail "start.sh again (restart) failed"; }
  grep -q "reusing the existing build" "$out/restart.log" || fail "the restart rebuilt the app instead of reusing the build"
  curl -sf http://localhost:3000/__trial/usage | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{const u=JSON.parse(s);if(!(u.restarts>=1))process.exit(1);console.log("[startup-check] ok: restarted by start.sh, build reused, restarts "+u.restarts)})' || fail "restart not recorded"
fi
n=$(curl -sf http://localhost:3000/api/family | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{try{console.log((JSON.parse(s).family||[]).length)}catch{console.log(-1)}})')
[ "$n" = "4" ] || fail "the household has $n people (expected the 4 added)"
ok "household kept: $n people"
echo "[startup-check] PASS ($mode)"

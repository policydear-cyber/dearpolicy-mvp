#!/usr/bin/env python3
"""Score DearPolicy replies against an r15 held-out battery.

Usage:
  python3 score.py H4/battery.json responses.json [--json out.json] [--show-fail 30]

responses.json format:
  {"singles": {"H4-S001": "reply text", ...},
   "conversations": {"H4-C01": ["reply to turn 1", "reply to turn 2", ...], ...}}

Each item passes when:
  1. every expected group matches (any alternative appears in the reply),
  2. no forbidden string appears,
  3. the behaviour marker check passes (see BEHAVIOUR_MARKERS; heuristic - use an LLM judge
     with the behaviour definitions in battery.json for a stricter grade).
Missing replies count as failures.
"""
import argparse
import json
import re
import sys
import unicodedata
from collections import defaultdict

NUMLIKE = re.compile(r"^(?:S\$|\$)?\d[\d,]*(?:\.\d+)?%?$")


def norm(s):
    s = unicodedata.normalize("NFKC", str(s)).replace("\u00a0", " ").lower()
    s = re.sub(r"(?<=\d),(?=\d{3}(?!\d))", "", s)
    s = s.replace("s$", "$").replace("sgd ", "$").replace("sgd", "$")
    s = re.sub(r"[\u2018\u2019]", "'", s)
    return re.sub(r"\s+", " ", s).strip()


def match(text, token):
    t, k = norm(text), norm(token)
    if NUMLIKE.match(token.strip()):
        num = k.lstrip("$").rstrip("%")
        pat = r"(?<![\d.])" + re.escape(num) + r"(?:\.0+)?(?![\d])"
        if k.endswith("%"):
            pat += r"\s*(?:%|per ?cent)"
        return re.search(pat, t) is not None
    return k in t


BEHAVIOUR_MARKERS = {
    "clarify": r"\?",
    "not_uploaded": r"(not (been )?uploaded|haven't (been )?uploaded|not (among|in|part of) (the|your) (uploaded|documents|files)|"
                    r"(don't|do not|can't|cannot|couldn't|could not) (see|find|locate)|no (such |matching )?(policy|document|record)|upload)",
    "not_covered": r"(not covered|isn't covered|aren't covered|doesn't cover|does not cover|not insured|excluded|exclusion|"
                   r"not (named|listed|elected|included)|no cover|no (death )?benefit|nothing (is )?payable|won't (be )?(covered|pay)|will not (be )?(covered|pay)|cannot claim|can't claim)",
    "expired": r"(expired|lapsed|ended on|no longer (in force|active|valid)|not (active|in force|valid))",
    "unreadable": r"(can't read|cannot read|couldn't read|could not read|unable to read|unreadable|garbled|corrupt|"
                  r"password|locked|re-?upload|readable copy|not readable)",
    "advice_decline": r"(adviser|advisor|financial advice|licensed|can't (recommend|advise)|cannot (recommend|advise)|"
                      r"not able to (recommend|advise)|depends on (your|you)|personal (situation|circumstances|needs)|"
                      r"your (insurer|agent))",
    "claim_start": r"(\?|submit|document|form|bill|receipt|claim)",
    "claim_step": r"(\?|submit|document|form|bill|receipt|claim|\d)",
}


def grade(item, reply):
    reasons = []
    if reply is None or not str(reply).strip():
        return False, ["no reply"]
    for grp in item["expected"]:
        if not any(match(reply, alt) for alt in grp):
            reasons.append(f"missing one of {grp[:4]}")
    for fb in item["forbidden"]:
        if match(reply, fb):
            reasons.append(f"forbidden {fb!r}")
    pat = BEHAVIOUR_MARKERS.get(item["behaviour"])
    if pat and not re.search(pat, norm(reply)):
        reasons.append(f"behaviour marker for {item['behaviour']} not found")
    return not reasons, reasons


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("battery")
    ap.add_argument("responses")
    ap.add_argument("--json")
    ap.add_argument("--show-fail", type=int, default=25)
    a = ap.parse_args()
    bat = json.load(open(a.battery, encoding="utf-8"))
    resp = json.load(open(a.responses, encoding="utf-8"))
    rs, rc = resp.get("singles", {}), resp.get("conversations", {})
    results = []
    for s in bat["singles"]:
        ok, why = grade(s, rs.get(s["id"]))
        results.append({"id": s["id"], "kind": "single", "behaviour": s["behaviour"], "pass": ok, "why": why,
                        "message": s["message"]})
    for c in bat["conversations"]:
        replies = rc.get(c["id"], [])
        for t in c["turns"]:
            r = replies[t["turn"] - 1] if len(replies) >= t["turn"] else None
            ok, why = grade(t, r)
            results.append({"id": f"{c['id']}.t{t['turn']}", "kind": "turn", "behaviour": t["behaviour"], "pass": ok,
                            "why": why, "message": t["user"]})
    by = defaultdict(lambda: [0, 0])
    for r in results:
        by[r["behaviour"]][0] += r["pass"]
        by[r["behaviour"]][1] += 1
    tot = sum(r["pass"] for r in results)
    print(f"{bat['household_id']}: {tot}/{len(results)} passed ({100*tot/max(1,len(results)):.1f}%)")
    for k in sorted(by):
        p, n = by[k]
        print(f"  {k:15s} {p:4d}/{n:<4d}")
    fails = [r for r in results if not r["pass"]]
    for r in fails[: a.show_fail]:
        print(f"  FAIL {r['id']}: {r['message'][:70]!r} -> {'; '.join(r['why'])}")
    if a.json:
        json.dump({"household": bat["household_id"], "passed": tot, "total": len(results), "results": results},
                  open(a.json, "w"), indent=1, ensure_ascii=False)
    return 0 if tot == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())

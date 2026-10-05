#!/usr/bin/env python3
"""Reference scorer for the r7 battery.

Usage:
  python3 score.py H1-tan/battery.json answers.jsonl [--report out.json]

answers.jsonl: one JSON object per line:
  {"id": "H1-S001", "answer": "<full answer text incl. details>", "behaviour": "answer", "citations": [{"doc": "h1_d1_ahkow_isp", "page": 2}]}
  For conversations: {"id": "H1-C03", "turn": 4, "answer": "...", ...}
"behaviour" and "citations" are optional; if absent those checks are reported as 'unchecked'.
Text checks are deterministic and deliberately simple; borderline cases (forbidden_unless_qualified,
behaviour classification, notes) are meant for a human or LLM grader.
"""
import json, re, sys

def norm(s):
    s = s.lower().replace("’", "'").replace(" ", " ")
    s = re.sub(r"\b(us\$|usd)\s*", "usd", s)
    s = re.sub(r"(?<![a-z])(s\$|sgd|\$)\s*", "", s)
    s = re.sub(r"(?<=\d),(?=\d{3}\b)", "", s)
    s = re.sub(r"(?<=\d)\.00(?!\d)", "", s)
    return re.sub(r"\s+", " ", s).strip()

def contains(answer_n, value):
    v = norm(value)
    if re.search(r"\d", v):
        return re.search(r"(?<![\d.])" + re.escape(v) + r"(?!\d|\.\d)", answer_n) is not None
    return v in answer_n

def hit(answer, answer_n, spec):
    if isinstance(spec, dict) and "regex" in spec:
        return re.search(spec["regex"], answer, re.I) is not None
    if isinstance(spec, dict) and "any_of" in spec:
        return any(contains(answer_n, x) for x in spec["any_of"])
    return contains(answer_n, spec)

def check(item, ans, global_forbidden):
    text = ans.get("answer", ""); n = norm(text); res = {"missing": [], "forbidden_hits": [], "qualify_review": []}
    for m in item["must_include"]:
        if not hit(text, n, m): res["missing"].append(m)
    for f in list(item["forbidden"]) + list(global_forbidden):
        if hit(text, n, f): res["forbidden_hits"].append(f)
    for f in item.get("forbidden_unless_qualified", []):
        if hit(text, n, f): res["qualify_review"].append(f)
    beh = ans.get("behaviour")
    ok_beh = [item["expected_behaviour"]] + item.get("also_acceptable", [])
    res["behaviour"] = "unchecked" if beh is None else ("ok" if beh in ok_beh else "wrong:%s" % beh)
    if item.get("cite") and ans.get("citations") is not None:
        got = {(c.get("doc"), c.get("page")) for c in ans["citations"]}
        res["cite"] = "ok" if any((c["doc"], c["page"]) in got for c in item["cite"]) else "missing"
    res["pass"] = not res["missing"] and not res["forbidden_hits"] and res["behaviour"] in ("ok", "unchecked") and res.get("cite", "ok") == "ok"
    return res

def main():
    battery = json.load(open(sys.argv[1]))
    answers = {}
    for line in open(sys.argv[2]):
        if line.strip():
            a = json.loads(line); answers[(a["id"], a.get("turn"))] = a
    out, passed, total = [], 0, 0
    items = [(s["id"], None, s) for s in battery["singles"]] + [(c["id"], t["turn"], t) for c in battery["conversations"] for t in c["turns"]]
    for iid, turn, item in items:
        a = answers.get((iid, turn))
        if a is None: continue
        r = check(item, a, battery.get("global_forbidden", [])); r.update(id=iid, turn=turn); out.append(r)
        total += 1; passed += r["pass"]
    print("scored %d / %d items, passed %d" % (total, len(items), passed))
    for r in out:
        if not r["pass"]: print("FAIL", r["id"], r["turn"] or "", json.dumps({k: v for k, v in r.items() if k not in ("id", "turn", "pass")}, ensure_ascii=False))
    if "--report" in sys.argv: json.dump(out, open(sys.argv[sys.argv.index("--report") + 1], "w"), indent=1, ensure_ascii=False)

if __name__ == "__main__":
    main()

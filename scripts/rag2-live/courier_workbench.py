"""
Workbench side of the courier (scripts/rag2-live/courier.ts). Paste this file into ONE workbench cell, once; it defines
`courier_run(payload_json)`, which the next cells call with the payload printed by `courier.ts prep`.

What it does, per item: rebuilds the request body from the delta against a body it already holds, checks the body's sha256
against the one the sandbox recorded, refuses anything but POST /v1/chat/completions to the allowed model without streaming
and within the output ceiling and the cumulative US$ cap, calls the model through the existing dedicated `openai` connection
(proxy_execute: the key is injected server-side and never visible here), and prints ONE line per item for the sandbox's
`courier.ts apply`: {key, req_sha, status, response (compact JSON text), resp_sha, upstream_ms, at}. It logs only usage and
latency (never content) to /home/user/courier-log.jsonl. Nothing else is called; no resource is created.
"""
import hashlib
import json
import math
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor

COURIER_ALLOWED_MODELS = {"gpt-6-luna"}
COURIER_MAX_OUTPUT = 2000
COURIER_HARD_CAP_USD = 0.25  # the pre-registered worst case of fx-live-1; the payload's own cap may only be lower
COURIER_PRICE = (0.10, 0.50)  # US$ per million input / output tokens (gpt-6-luna on file); cached input not discounted
COURIER_LOG = "/home/user/courier-log.jsonl"

try:
    COURIER_BODIES
except NameError:
    COURIER_BODIES = {}
    COURIER_SPENT = [0.0]
    COURIER_CALLS = [0]
    COURIER_LOCK = threading.Lock()


def _sha(s):
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


def _plain(obj):
    try:
        return json.loads(json.dumps(obj, default=lambda o: dict(o) if isinstance(o, dict) else str(o)))
    except Exception:
        return obj


def _rebuild(item):
    if "full" in item:
        return item["full"]
    base = COURIER_BODIES[item["base"]].encode("utf-16-le")
    out = []
    for h in item["hunks"]:
        if h[0] == 0:
            out.append(base[2 * h[1]:2 * h[2]].decode("utf-16-le"))
        else:
            out.append(h[1])
    return "".join(out)


def _one(item, cap):
    t0 = time.time()
    line = {"key": item["key"], "req_sha": item["sha"], "status": 0, "response": "", "resp_sha": "", "upstream_ms": None,
            "at": time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(t0)) + "Z"}

    def refuse(status, msg):
        line["status"] = status
        line["response"] = json.dumps({"error": {"message": "courier: " + msg}}, separators=(",", ":"))
        line["resp_sha"] = _sha(line["response"])
        return line

    try:
        text = _rebuild(item)
    except Exception as exc:
        return refuse(400, "could not rebuild the request: %s" % exc)
    if _sha(text) != item["sha"]:
        return refuse(400, "request checksum mismatch (transcription error: send this item again)")
    with COURIER_LOCK:
        COURIER_BODIES[item["sha"]] = text
    try:
        body = json.loads(text)
    except Exception:
        return refuse(400, "request is not JSON")
    if body.get("model") not in COURIER_ALLOWED_MODELS:
        return refuse(403, "model %r is not allowed" % body.get("model"))
    if body.get("stream"):
        return refuse(400, "streaming is not relayed")
    if int(body.get("max_completion_tokens") or body.get("max_tokens") or 0) > COURIER_MAX_OUTPUT:
        return refuse(400, "output ceiling exceeded")
    reserve = (math.ceil(len(text) / 2.5) * COURIER_PRICE[0] + int(body.get("max_completion_tokens") or body.get("max_tokens") or COURIER_MAX_OUTPUT) * COURIER_PRICE[1]) / 1_000_000
    with COURIER_LOCK:
        if COURIER_SPENT[0] + reserve > min(cap, COURIER_HARD_CAP_USD) + 1e-12:
            return refuse(429, "run cap: spent %.6f + this call's worst case %.6f would pass %.2f" % (COURIER_SPENT[0], reserve, min(cap, COURIER_HARD_CAP_USD)))
        COURIER_SPENT[0] += reserve  # held until settled below
        COURIER_CALLS[0] += 1
    try:
        u0 = time.time()
        data, err = proxy_execute("POST", "https://api.openai.com/v1/chat/completions", "openai", body=body)  # noqa: F821 (workbench helper)
        line["upstream_ms"] = round((time.time() - u0) * 1000)
    except Exception as exc:
        data, err = None, "helper raised %s: %s" % (type(exc).__name__, exc)
    settled = reserve
    if err:
        m = re.match(r"API returned status (\d+)", str(err))
        status = int(m.group(1)) if m else 502
        line["status"] = status
        line["response"] = json.dumps({"error": {"message": re.sub(r"sk-[A-Za-z0-9_\-]{6,}", "sk-***", str(err))[:400]}}, separators=(",", ":"))
        if status == 400:
            settled = 0.0  # a 400 is not billed
    else:
        payload = _plain(data)
        if isinstance(payload, dict) and "choices" not in payload and isinstance(payload.get("data"), dict) and "choices" in payload["data"]:
            payload = payload["data"]
        msg = ((payload.get("choices") or [{}])[0] or {}).get("message") or {}
        usage = payload.get("usage") or {}
        compact = {"id": payload.get("id"), "model": payload.get("model"),
                   "choices": [{"index": 0, "message": {"role": "assistant", "content": msg.get("content"), **({"tool_calls": msg["tool_calls"]} if msg.get("tool_calls") else {})},
                                "finish_reason": ((payload.get("choices") or [{}])[0] or {}).get("finish_reason")}],
                   "usage": {"prompt_tokens": usage.get("prompt_tokens"), "completion_tokens": usage.get("completion_tokens"),
                             **({"prompt_tokens_details": {"cached_tokens": (usage.get("prompt_tokens_details") or {}).get("cached_tokens")}} if usage.get("prompt_tokens_details") else {})}}
        line["status"] = 200
        line["response"] = json.dumps(compact, separators=(",", ":"), ensure_ascii=False)
        settled = ((usage.get("prompt_tokens") or 0) * COURIER_PRICE[0] + (usage.get("completion_tokens") or 0) * COURIER_PRICE[1]) / 1_000_000
    line["resp_sha"] = _sha(line["response"])
    with COURIER_LOCK:
        COURIER_SPENT[0] += settled - reserve
        with open(COURIER_LOG, "a", encoding="utf-8") as f:  # usage and latency only, never content
            f.write(json.dumps({"at": line["at"], "key": item["key"], "status": line["status"], "upstream_ms": line["upstream_ms"],
                                "usage": (json.loads(line["response"]).get("usage") if line["status"] == 200 else None), "settled_usd": round(settled, 8)}) + "\n")
    return line


def courier_run(payload_json, workers=4):
    payload = json.loads(payload_json)
    cap = float(payload.get("cap", COURIER_HARD_CAP_USD))
    items = payload["items"]
    # items are rebuilt in order (a later item may use an earlier one of the same batch as its base), then called in parallel
    prepared = []
    for it in items:
        try:
            text = _rebuild(it)
            if _sha(text) == it["sha"]:
                COURIER_BODIES[it["sha"]] = text
        except Exception:
            pass
        prepared.append(it)
    with ThreadPoolExecutor(max_workers=workers) as ex:
        lines = list(ex.map(lambda it: _one(it, cap), prepared))
    for ln in lines:
        print(json.dumps(ln, separators=(",", ":"), ensure_ascii=False))
    print("# spent so far (workbench view, settled) US$%.6f over %d calls" % (COURIER_SPENT[0], COURIER_CALLS[0]))

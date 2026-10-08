"""
DearPolicy live-model smoke: the loopback OpenAI relay.

Runs as a daemon thread INSIDE the Composio workbench kernel, because the credential helper `proxy_execute` exists
only there. The app (lib/rag2/loop/hosted-model.ts) is pointed at it with
    OPENAI_BASE_URL=http://127.0.0.1:8787/v1   OPENAI_API_KEY=<any non-secret dummy>
and sends ordinary, NON-streaming OpenAI chat-completions requests. The relay forwards method, path and JSON body
through proxy_execute(method, endpoint, "openai", body=...), which injects the spend-limited test key SERVER-SIDE (the
key never enters this sandbox), and returns the provider's status and JSON body unchanged.

Safety:
  - listens on 127.0.0.1 only; forwards only POST /v1/chat/completions and GET /v1/models; nothing else;
  - incoming headers are never forwarded or logged (the dummy Authorization header is dropped);
  - only the allowed model ids (default: gpt-6-luna) are forwarded; "stream": true is refused (the app never streams);
  - a hard per-relay request ceiling (default 300) as a last-resort breaker; the run's US$ cap is enforced in the app
    (lib/rag2/loop/usage-meter.ts + e2e/support/rag2-live-guard.ts), before a request ever reaches the relay;
  - errors from the helper (no openai connection, proxy disabled, network) come back as a clean OpenAI-style error
    JSON with 401 / 403 / 502 -- never a crash, never a credential.
Each request appends one JSON line to the log: time, endpoint, requested model, provider-reported model, request
settings (temperature, max tokens, tool_choice, parallel_tool_calls, reasoning_effort), sha256 of the system prompt's
fixed part and of the tool schema, usage tokens, upstream latency (the proxy hop, measured here) and relay latency,
status, finish reason, tool names called. Never headers, never credentials, never message content.

Loader (in a workbench cell):
    exec(open("/home/user/wt-H/scripts/rag2-live/relay.py").read())
    relay = start_relay(proxy_execute)            # live: the Composio "openai" connection
    # ... run the harness ...
    relay.stop()
Plumbing test (no model, no credential): see scripts/rag2-live/plumbing_fake.py.
"""
import hashlib
import http.server
import json
import re
import threading
import time

RELAY_DEFAULT_LOG = "/home/user/rag2-live-relay.jsonl"
_SYSTEM_SPLIT = "\n\nConversation state:"


def _canon(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def _sha(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _scrub(text):
    text = str(text or "")
    text = re.sub(r"sk-[A-Za-z0-9_\-]{6,}", "sk-***", text)
    text = re.sub(r"(?i)bearer\s+[A-Za-z0-9._\-]+", "Bearer ***", text)
    return text.replace("\n", " ")[:300]


def _plain(obj):
    """proxy_execute may return a dict subclass (ToolResponse); make it plain JSON data."""
    try:
        return json.loads(json.dumps(obj, default=lambda o: dict(o) if isinstance(o, dict) else str(o)))
    except Exception:
        return obj


def _classify_helper_error(err):
    e = str(err or "")
    low = e.lower()
    if "disabled" in low:
        return 403, "proxy_execution_disabled"
    if any(w in low for w in ("no connected account", "connected account", "no connection", "connection not found", "not connected", "no active", "auth config", "account not found")):
        return 401, "no_openai_connection"
    return 502, "relay_upstream_unreachable"


class _Relay:
    def __init__(self, proxy, port, mode, allowed_models, log_path, upstream_base, toolkit, max_requests, max_body):
        self.proxy = proxy
        self.port = port
        self.mode = mode
        self.allowed_models = set(allowed_models)
        self.log_path = log_path
        self.upstream_base = upstream_base.rstrip("/")
        self.toolkit = toolkit
        self.max_requests = max_requests
        self.max_body = max_body
        self.requests = 0
        self.lock = threading.Lock()
        self.server = None
        self.thread = None

    def log(self, entry):
        with self.lock:
            with open(self.log_path, "a", encoding="utf-8") as f:
                f.write(json.dumps(entry, ensure_ascii=False) + "\n")

    def stop(self):
        if self.server:
            self.server.shutdown()
            self.server.server_close()
            self.server = None

    def health(self):
        return {"ok": True, "relay": "dearpolicy-rag2-live", "mode": self.mode, "port": self.port, "log": self.log_path,
                "requests": self.requests, "max_requests": self.max_requests, "allowed_models": sorted(self.allowed_models)}


def start_relay(proxy, port=8787, mode="live", allowed_models=("gpt-6-luna",), log_path=RELAY_DEFAULT_LOG,
                upstream_base="https://api.openai.com/v1", toolkit="openai", max_requests=300, max_body=2_000_000):
    """Starts the relay on 127.0.0.1:<port> in a daemon thread and returns it (call .stop() to end it).
    `proxy` has proxy_execute's contract: proxy(method, endpoint, toolkit, query_params=None, body=None, headers=None)
    -> (data, error) with error == "" on success and "API returned status N: ..." for a provider error."""
    relay = _Relay(proxy, port, mode, allowed_models, log_path, upstream_base, toolkit, max_requests, max_body)

    class Handler(http.server.BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, *args):  # no stderr access log (it would print paths only, but keep the kernel quiet)
            return

        def _send(self, status, payload):
            data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def _error(self, status, code, message):
            self._send(status, {"error": {"message": "relay: " + message, "type": "relay_error", "code": code}})
            return status

        def do_GET(self):
            path = self.path.split("?")[0]
            if path == "/__relay/health":
                return self._send(200, relay.health())
            if path == "/v1/models":
                return self._forward("GET", "/models", None)
            return self._error(404, "not_relayed", "only POST /v1/chat/completions and GET /v1/models are relayed")

        def do_POST(self):
            path = self.path.split("?")[0]
            if path != "/v1/chat/completions":
                return self._error(404, "not_relayed", "only POST /v1/chat/completions and GET /v1/models are relayed")
            length = int(self.headers.get("content-length") or 0)
            if length <= 0 or length > relay.max_body:
                return self._error(413, "body_size", "request body missing or too large")
            try:
                body = json.loads(self.rfile.read(length).decode("utf-8"))
            except Exception:
                return self._error(400, "bad_json", "request body is not JSON")
            return self._forward("POST", "/chat/completions", body)

        def _forward(self, method, sub, body):
            t0 = time.time()
            entry = {"at": time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(t0)) + "Z", "t": round(t0, 3), "mode": relay.mode,
                     "method": method, "endpoint": "/v1" + sub}
            if isinstance(body, dict):
                msgs = body.get("messages") or []
                system = next((m.get("content") for m in msgs if isinstance(m, dict) and m.get("role") == "system"), "") or ""
                entry.update({
                    "requested_model": body.get("model"),
                    "settings": {k: body.get(k) for k in ("temperature", "max_completion_tokens", "max_tokens", "tool_choice", "parallel_tool_calls", "reasoning_effort", "top_p", "seed") if k in body},
                    "messages": len(msgs), "tools": len(body.get("tools") or []),
                    "tools_sha256": _sha(_canon(body.get("tools") or [])),
                    "system_prompt_sha256": _sha(system.split(_SYSTEM_SPLIT)[0]) if system else None,
                })
            status = None
            try:
                if isinstance(body, dict) and body.get("stream"):
                    status = self._error(400, "stream_unsupported", "streaming is not relayed (the app does not stream)")
                    return
                if isinstance(body, dict) and body.get("model") not in relay.allowed_models:
                    status = self._error(403, "model_not_allowed", "model %r is not in the relay's allowed list %s" % (body.get("model"), sorted(relay.allowed_models)))
                    return
                with relay.lock:
                    if relay.requests >= relay.max_requests:
                        status = self._error(429, "relay_request_ceiling", "the relay's request ceiling (%d) is reached" % relay.max_requests)
                        return
                    relay.requests += 1
                u0 = time.time()
                try:
                    if body is None:
                        data, err = relay.proxy(method, relay.upstream_base + sub, relay.toolkit)
                    else:
                        data, err = relay.proxy(method, relay.upstream_base + sub, relay.toolkit, body=body)
                except Exception as exc:  # the helper itself failed: never crash the relay
                    data, err = None, "helper raised %s: %s" % (type(exc).__name__, exc)
                entry["upstream_ms"] = round((time.time() - u0) * 1000)
                if not err:
                    payload = _plain(data)
                    if isinstance(payload, dict) and "choices" not in payload and isinstance(payload.get("data"), dict) and "choices" in payload["data"]:
                        payload = payload["data"]
                    status = 200
                    if isinstance(payload, dict):
                        usage = payload.get("usage") or {}
                        choice = (payload.get("choices") or [{}])[0] or {}
                        msg = choice.get("message") or {}
                        entry.update({
                            "provider_model": payload.get("model"), "provider_request_id": payload.get("id"),
                            "usage": {"prompt_tokens": usage.get("prompt_tokens"), "completion_tokens": usage.get("completion_tokens"),
                                      "total_tokens": usage.get("total_tokens"),
                                      "cached_tokens": (usage.get("prompt_tokens_details") or {}).get("cached_tokens"),
                                      "reasoning_tokens": (usage.get("completion_tokens_details") or {}).get("reasoning_tokens")},
                            "finish_reason": choice.get("finish_reason"),
                            "tool_calls": [((c or {}).get("function") or {}).get("name") for c in (msg.get("tool_calls") or [])],
                        })
                    self._send(200, payload)
                    return
                m = re.match(r"API returned status (\d{3})", str(err))
                if m:
                    status = int(m.group(1))
                    upstream = _plain(data)
                    inner = upstream.get("data") if isinstance(upstream, dict) else None
                    body_out = inner if isinstance(inner, dict) and inner else {"error": {"message": "upstream: " + _scrub(err), "type": "upstream_error", "code": status}}
                    entry["error"] = _scrub(err)
                    self._send(status, body_out)
                    return
                status, code = _classify_helper_error(err)
                entry["error"] = code + ": " + _scrub(err)
                self._error(status, code, code.replace("_", " ") + " -- " + _scrub(err))
            finally:
                entry["status"] = status
                entry["relay_ms"] = round((time.time() - t0) * 1000)
                relay.log(entry)

    class Server(http.server.ThreadingHTTPServer):
        daemon_threads = True
        allow_reuse_address = True

    relay.server = Server(("127.0.0.1", port), Handler)
    relay.thread = threading.Thread(target=relay.server.serve_forever, name="rag2-live-relay", daemon=True)
    relay.thread.start()
    return relay

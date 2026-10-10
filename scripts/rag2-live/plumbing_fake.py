"""
DearPolicy live-model smoke -- PLUMBING TEST ONLY. NOT A MODEL. Its replies are never model results.

A local fake OpenAI-compatible endpoint (127.0.0.1:8790) and a stand-in for the workbench's proxy_execute helper with
the same return contract, so the relay (relay.py) and the harness (run.ts) can be exercised end to end without any
credential or network call:
    app -> relay 127.0.0.1:8787 -> fake_proxy (proxy_execute's contract) -> fake endpoint 127.0.0.1:8790
The fake answers every turn in two steps: search_passages with the user's words, then final_answer with one fixed
"PLUMBING TEST" sentence (no figure, no cover statement). It reports token usage so accounting is exercised, and
reports its model as "plumbing-fake-not-a-model" so it can never be mistaken for a provider result.
`fail_first` makes its first N requests return HTTP 500 with no usage (exercises retries + reservation accounting).

Loader (in a workbench cell):
    exec(open("/home/user/wt-H/scripts/rag2-live/relay.py").read())
    exec(open("/home/user/wt-H/scripts/rag2-live/plumbing_fake.py").read())
    fake = start_fake_upstream(fail_first=1)
    relay = start_relay(fake_proxy, mode="PLUMBING TEST")
"""
import http.server
import json
import threading
import urllib.error
import urllib.request

FAKE_PORT = 8790
FAKE_MODEL = "plumbing-fake-not-a-model"
PLUMBING_SENTENCE = "PLUMBING TEST: this reply comes from a local fake endpoint, not from a model."


def _fake_reply(body, n):
    msgs = body.get("messages") or []
    last_user = max((i for i, m in enumerate(msgs) if m.get("role") == "user"), default=-1)
    called = any(m.get("role") == "assistant" and m.get("tool_calls") for m in msgs[last_user + 1:])
    if not called:
        name, args = "search_passages", {"query": str(msgs[last_user].get("content") if last_user >= 0 else "policy")[:200]}
    else:
        name, args = "final_answer", {"sentences": [{"text": PLUMBING_SENTENCE}]}
    prompt = len(json.dumps(msgs)) // 4 + len(json.dumps(body.get("tools") or [])) // 4
    return {"id": "fake-%d" % n, "object": "chat.completion", "model": FAKE_MODEL,
            "choices": [{"index": 0, "finish_reason": "tool_calls", "message": {"role": "assistant", "content": None,
                         "tool_calls": [{"id": "call_fake_%d" % n, "type": "function", "function": {"name": name, "arguments": json.dumps(args)}}]}}],
            "usage": {"prompt_tokens": prompt, "completion_tokens": 40, "total_tokens": prompt + 40}}


def start_fake_upstream(port=FAKE_PORT, fail_first=0):
    state = {"n": 0, "fail_left": fail_first, "lock": threading.Lock()}

    class H(http.server.BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, *a):
            return

        def _send(self, status, payload):
            data = json.dumps(payload).encode()
            self.send_response(status)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self):
            if self.path.startswith("/v1/models"):
                return self._send(200, {"object": "list", "data": [{"id": FAKE_MODEL, "object": "model"}]})
            self._send(404, {"error": {"message": "fake: not found"}})

        def do_POST(self):
            if not self.path.startswith("/v1/chat/completions"):
                return self._send(404, {"error": {"message": "fake: not found"}})
            body = json.loads(self.rfile.read(int(self.headers.get("content-length") or 0)) or b"{}")
            with state["lock"]:
                state["n"] += 1
                n = state["n"]
                fail = state["fail_left"] > 0
                if fail:
                    state["fail_left"] -= 1
            if fail:
                return self._send(500, {"error": {"message": "fake: injected server error (PLUMBING TEST)", "type": "server_error"}})
            self._send(200, _fake_reply(body, n))

    class S(http.server.ThreadingHTTPServer):
        daemon_threads = True
        allow_reuse_address = True

    srv = S(("127.0.0.1", port), H)
    threading.Thread(target=srv.serve_forever, name="rag2-live-fake-upstream", daemon=True).start()
    srv.state = state
    return srv


def fake_proxy(method, endpoint, toolkit, query_params=None, body=None, headers=None):
    """proxy_execute's contract, against the local fake: (data, "") on success; ({"status": N, "data": body},
    "API returned status N: ...") on a provider error; (None, message) when the helper itself fails."""
    if toolkit != "openai":
        return None, "fake_proxy: unexpected toolkit"
    path = endpoint.split("/v1", 1)[-1]
    req = urllib.request.Request("http://127.0.0.1:%d/v1%s" % (FAKE_PORT, path), method=method,
                                 data=None if body is None else json.dumps(body).encode(),
                                 headers={"content-type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read() or b"{}"), ""
    except urllib.error.HTTPError as e:
        payload = json.loads(e.read() or b"{}")
        return {"status": e.code, "data": payload}, "API returned status %d: %s" % (e.code, (payload.get("error") or {}).get("message", ""))
    except Exception as e:
        return None, "Failed to execute proxy request: %s" % e


def no_connection_proxy(method, endpoint, toolkit, query_params=None, body=None, headers=None):
    """What the helper returns when no openai connection exists (used to check the relay's clean error)."""
    return None, "No connected account found for toolkit 'openai'"

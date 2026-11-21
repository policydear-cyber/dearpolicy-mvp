/** What an error report to Sentry may contain. An ALLOWLIST: the report is rebuilt from the few fields below, so a field
 * the SDK adds later (request body, cookies, headers, user, extra data, breadcrumbs, local variables, source lines) is
 * dropped by default rather than needing to be remembered. Policy text, names, amounts and emails can sit in an error
 * message or a request, so no message text is sent: the error's type and its safe category (lib/telemetry/errors.ts)
 * stand in for it, with the stack's file, function and line numbers. Pure; no SDK import, so tests run offline. */
import { classifyError } from "./errors";

type Frame = { filename?: string; function?: string; lineno?: number; colno?: number; in_app?: boolean; module?: string };
type Ev = {
  event_id?: string; timestamp?: number; platform?: string; level?: string; release?: string; environment?: string;
  exception?: { values?: { type?: string; value?: string; stacktrace?: { frames?: Frame[] }; mechanism?: { type?: string; handled?: boolean } }[] };
  request?: { method?: string; url?: string };
  tags?: Record<string, unknown>; contexts?: { runtime?: { name?: string; version?: string } };
  transaction?: string;
};

/** A path with anything that could identify a record removed: query and fragment dropped, ids (UUIDs, numbers, long
 * tokens) replaced by ":id". A host is dropped too; only the path is kept. */
export function routeOnly(input: unknown): string | undefined {
  if (typeof input !== "string" || !input) return undefined;
  let path = input;
  try { if (/^[a-z]+:\/\//i.test(path)) path = new URL(path).pathname; } catch { return undefined; }
  path = path.split(/[?#]/)[0];
  return path.split("/").map((seg) => (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f-]{20,}$/i.test(seg) || /^\d+$/.test(seg) || /^[A-Za-z0-9_-]{24,}$/.test(seg) ? ":id" : seg)).join("/").slice(0, 200);
}

/** Frame file names carry no household data, but keep them short and drop any query string. */
function frameOf(f: Frame): Frame {
  return { filename: f.filename?.split("?")[0].slice(-200), function: f.function?.slice(0, 120), lineno: f.lineno, colno: f.colno, in_app: f.in_app, module: f.module?.slice(0, 120) };
}

export function scrubSentryEvent<T extends Ev>(event: T): Ev | null {
  const values = event.exception?.values;
  // A report with no exception (a message, a transaction) carries nothing this scrubber can vouch for.
  if (!values?.length) return null;
  const out: Ev = {
    event_id: event.event_id, timestamp: event.timestamp, platform: event.platform, level: event.level, release: event.release, environment: event.environment,
    exception: { values: values.map((v) => {
      const type = typeof v.type === "string" ? v.type.slice(0, 80) : "Error";
      // classifyError reads the class name; a scrubbed event only has the type string, so classify a stand-in of that name.
      const category = classifyError(Object.assign(new Error(), { constructor: { name: type } })).category;
      return { type, value: `${type} (${category})`, mechanism: v.mechanism ? { type: v.mechanism.type, handled: v.mechanism.handled } : undefined,
        stacktrace: v.stacktrace?.frames ? { frames: v.stacktrace.frames.slice(-60).map(frameOf) } : undefined };
    }) },
  };
  const method = event.request?.method, url = routeOnly(event.request?.url);
  if (method || url) out.request = { method, url };
  const transaction = routeOnly(event.transaction);
  if (transaction) out.transaction = transaction;
  if (event.contexts?.runtime) out.contexts = { runtime: { name: event.contexts.runtime.name, version: event.contexts.runtime.version } };
  const route = routeOnly(event.tags?.route ?? event.tags?.["http.route"]);
  out.tags = { ...(route ? { route } : {}), ...(typeof event.tags?.runtime === "string" ? { runtime: event.tags.runtime } : {}) };
  return out;
}

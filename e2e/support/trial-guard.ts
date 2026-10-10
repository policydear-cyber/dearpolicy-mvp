/**
 * TRIAL mode (scripts/trial/start.sh, e2e/support/trial-server.ts): the owner's hands-on trial in a GitHub Codespace --
 * the real app on the local stack (local Postgres, local file storage, development identity of one synthetic household)
 * with the REAL model, behind the same process-wide fetch guard as the live tests.
 *
 * Allowed ONLY when every one of these holds (trialSafetyChecks throws with the first that does not):
 *   CODESPACES=true and TRIAL_MODE=1; NODE_ENV=test; VERCEL / VERCEL_ENV unset; DATABASE_URL on localhost / 127.0.0.1;
 *   OPENAI_BASE_URL unset or exactly https://api.openai.com/v1; no other provider key (Anthropic, Gemini, Groq), no
 *   Pinecone or VirusTotal key, no deterministic stand-in; every model role = openai:gpt-6-luna (no substitution);
 *   OPENAI_API_KEY present (the Codespaces secret OPENAI_TEST_API_KEY, passed by start.sh to the server only, or the
 *   placeholder "preflight-no-key-set" -> PREFLIGHT: every model call refused); TRIAL_CAP_USD in (0, 0.25] = the open
 *   trial allocation reserved in docs/rag-migration/live/LEDGER.json (start.sh reads it); TRIAL_ALLOCATION_ID and
 *   CODESPACE_NAME set.
 * The spend is PERSISTED (.trial/ledger.json, bound to the allocation and this Codespace): it survives restarts of this
 * Codespace; an unsettled reservation found at start (the process died mid-call) is counted as spent; a damaged or
 * foreign record is refused. It does NOT follow a deleted or second Codespace (docs/trial/TRIAL.md, "Budget"). When the cap is reached every model request is refused before it is sent
 * and the app shows its normal "the assistant model returned an error" answer.
 */
import fs from "node:fs";
import path from "node:path";
import { modelFor, priceFor, type ModelChoice, type Price } from "@/lib/ai/providers";
import { RunCostLedger, type CostReservation } from "@/lib/rag2/loop/usage-meter";
import { NO_KEY_PLACEHOLDER, OPENAI_DIRECT_BASE } from "./rag2-live-guard";
import { readLocalLedger, TRIAL_MAX_ALLOCATION_USD } from "../../scripts/trial/isolation.mjs";

export const TRIAL_MODEL = "openai:gpt-6-luna";
export const TRIAL_MAX_CAP_USD = TRIAL_MAX_ALLOCATION_USD;
export const TRIAL_PREFLIGHT_REFUSAL = "trial preflight: OPENAI_TEST_API_KEY is not set, so no model call is made";

export function trialSafetyChecks(env: NodeJS.ProcessEnv = process.env): { choice: ModelChoice; price: Price; capUsd: number; preflight: boolean } {
  const fail = (m: string): never => { throw new Error("trial mode refused: " + m); };
  if (env.CODESPACES !== "true") fail("trial mode runs only inside a GitHub Codespace (CODESPACES=true)");
  if (env.TRIAL_MODE !== "1") fail("TRIAL_MODE must be 1 (scripts/trial/start.sh sets it)");
  if (env.NODE_ENV !== "test") fail("NODE_ENV must be \"test\"");
  if ((env.VERCEL ?? "") !== "" || (env.VERCEL_ENV ?? "") !== "") fail("VERCEL / VERCEL_ENV must be unset");
  const host = (u: string | undefined) => { try { return new URL(u ?? "").hostname; } catch { return ""; } };
  if (!["localhost", "127.0.0.1"].includes(host(env.DATABASE_URL))) fail(`DATABASE_URL must be the Codespace's local database (host "${host(env.DATABASE_URL)}")`);
  if (env.OPENAI_BASE_URL !== undefined && env.OPENAI_BASE_URL !== OPENAI_DIRECT_BASE) fail(`OPENAI_BASE_URL must be unset or exactly ${OPENAI_DIRECT_BASE}`);
  for (const k of ["ANTHROPIC_API_KEY", "GEMINI_API_KEY", "GROQ_API_KEY", "PINECONE_API_KEY", "VIRUSTOTAL_API_KEY", "DEARPOLICY_DETERMINISTIC_MODEL"]) if (env[k]) fail(`${k} must be unset in the trial`);
  const key = env.OPENAI_API_KEY ?? "";
  if (!key) fail("OPENAI_API_KEY must be set (start.sh passes the OPENAI_TEST_API_KEY Codespaces secret, or the preflight placeholder)");
  const preflight = key === NO_KEY_PLACEHOLDER;
  for (const [role, k] of [["chat", "CHAT_MODEL"], ["judgement", "JUDGEMENT_MODEL"], ["narration", "NARRATION_MODEL"], ["reading", "READING_MODEL"]] as const) {
    if ((env[k] ?? "").trim() !== TRIAL_MODEL) fail(`${k} must be ${TRIAL_MODEL}`);
    const got = modelFor(role);
    if (`${got.provider}:${got.model}` !== TRIAL_MODEL) fail(`${role} resolves to ${got.provider}:${got.model}, not ${TRIAL_MODEL}`);
  }
  if (!/^trial-codespace-\d{1,3}$/.test(env.TRIAL_ALLOCATION_ID ?? "")) fail("TRIAL_ALLOCATION_ID must be set by start.sh from the open allocation in docs/rag-migration/live/LEDGER.json");
  if (!env.CODESPACE_NAME) fail("CODESPACE_NAME must be set (one trial allowance per Codespace)");
  if (env.TRIAL_CAP_USD == null || env.TRIAL_CAP_USD === "") fail("TRIAL_CAP_USD must be set by start.sh (the open trial allocation)");
  const cap = Number(env.TRIAL_CAP_USD);
  if (!Number.isFinite(cap) || cap <= 0 || cap > TRIAL_MAX_CAP_USD) fail(`TRIAL_CAP_USD must be > 0 and <= ${TRIAL_MAX_CAP_USD} (got ${env.TRIAL_CAP_USD})`);
  const choice = modelFor("chat");
  const price = priceFor(choice) ?? fail(`no price on file for ${TRIAL_MODEL}`);
  return { choice, price, capUsd: cap, preflight };
}

export type TrialLedgerFile = { capUsd: number; spentUsd: number; inflightUsd: number; calls: number; refusals: number; startedAt: string; updatedAt: string; restarts: number; allocationId: string; codespace: string };
/** The run ledger, persisted after every reservation and settlement (atomic write). Bound to ONE trial allocation and ONE
 * Codespace: a record that is damaged, belongs to another allocation or another Codespace, or records another cap is
 * refused (scripts/trial/isolation.mjs readLocalLedger) -- spending is never silently reset to zero. */
export class PersistentTrialLedger extends RunCostLedger {
  readonly carriedUsd: number;
  constructor(readonly file: string, capUsd: number, readonly binding: { allocationId: string; codespace: string }) {
    super(capUsd);
    const prior = readLocalLedger(file, { id: binding.allocationId, usd: capUsd }, binding.codespace);
    // What earlier runs spent, plus anything they had reserved and never settled (counted as spent: fail closed).
    this.carriedUsd = prior ? prior.spentUsd + prior.inflightUsd : 0;
    this.spentUsd = this.carriedUsd;
    this.calls = Number(prior?.calls) || 0;
    this.refusals = Number(prior?.refusals) || 0;
    this.startedAt = prior?.startedAt ?? new Date().toISOString();
    this.restarts = (Number(prior?.restarts) || 0) + (prior ? 1 : 0);
    this.persist();
  }
  private readonly startedAt: string;
  private readonly restarts: number;
  override reserve(usd: number, estInputTokens: number, maxOutputTokens: number) { const r = super.reserve(usd, estInputTokens, maxOutputTokens); this.persist(); return r; }
  override settle(r: CostReservation, actualUsd: number | null) { const c = super.settle(r, actualUsd); this.persist(); return c; }
  state(): TrialLedgerFile {
    return { capUsd: this.capUsd, spentUsd: Math.round(this.spentUsd * 1e8) / 1e8, inflightUsd: Math.round(this.reservedUsd * 1e8) / 1e8, calls: this.calls, refusals: this.refusals, startedAt: this.startedAt, updatedAt: new Date().toISOString(), restarts: this.restarts, allocationId: this.binding.allocationId, codespace: this.binding.codespace };
  }
  private persist() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = this.file + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(this.state(), null, 2) + "\n");
    fs.renameSync(tmp, this.file);
  }
}

/** The app's own origin inside the Codespace: next() is created with hostname "localhost", so middleware's
 * request.nextUrl.origin (what lib/http/csrf.ts compares Origin with) is http://localhost:<port>. */
export const trialInternalOrigin = (port: number) => `http://localhost:${port}`;
/** Codespaces' port forwarding serves the app at https://<CODESPACE_NAME>-<port>.<GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN>
 * (private to the owner's GitHub account), so the browser's Origin is that public address while the app sees itself as
 * http://localhost:<port>, and lib/http/csrf.ts would refuse every POST. In the trial ONLY: a request forwarded for
 * THIS Codespace's own address (X-Forwarded-Host) whose Origin -- or, without one, Referer -- is exactly that address
 * is same-origin, and is presented to the app with its internal origin. Any other Origin (another site, another
 * Codespace) is left untouched and the app's unchanged CSRF check refuses it. Returns the header values to set, or null. */
export function codespacesSameOrigin(headers: Record<string, string | string[] | undefined>, env: NodeJS.ProcessEnv, port: number): { origin?: string; referer?: string } | null {
  const name = env.CODESPACE_NAME, domain = env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN;
  if (env.CODESPACES !== "true" || !name || !domain) return null;
  const one = (h: string | string[] | undefined) => String(Array.isArray(h) ? h[0] : h ?? "").split(",")[0].trim();
  const publicHost = `${name}-${port}.${domain}`.toLowerCase();
  if (one(headers["x-forwarded-host"]).toLowerCase() !== publicHost) return null;
  const publicOrigin = `https://${publicHost}`;
  const originOf = (u: string) => { try { return new URL(u).origin.toLowerCase(); } catch { return null; } };
  const origin = one(headers.origin), referer = one(headers.referer);
  const out: { origin?: string; referer?: string } = {};
  if (origin) { if (originOf(origin) !== publicOrigin) return null; out.origin = trialInternalOrigin(port); }
  if (referer && originOf(referer) === publicOrigin) { const u = new URL(referer); out.referer = trialInternalOrigin(port) + u.pathname + u.search; }
  return out.origin || out.referer ? out : null;
}

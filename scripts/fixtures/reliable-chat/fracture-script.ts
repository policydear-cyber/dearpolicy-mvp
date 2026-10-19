/**
 * The recorded model behaviour of the production fracture conversation (19 Oct 2026, f3c9bcd) as a script of tool calls for the
 * test-only ScriptedLoopModel, plus the helpers a script uses to read tool results. Shared by scripts/reliable-chat-fracture-replay.ts
 * (offline replay of the recorded conversation) and scripts/reliable-chat-usefulness-ab.ts (plumbing of the A/B harness).
 */
import * as FX from "./fracture-conversation";
import type { ScriptTurn, ScriptView } from "@/lib/rag2/loop/scripted-model";

export const call = (name: string, args: Record<string, unknown>) => ({ name, arguments: args });

/** Evidence ids, in any tool result of this turn, of an entry whose text matches. */
export const idsAny = (v: ScriptView, re: RegExp, tool?: string): string[] => {
  const out: string[] = [];
  const walk = (x: any) => { if (!x || typeof x !== "object") return; if (typeof x.evidence_id === "string" && Object.values(x).some((f) => typeof f === "string" && re.test(f))) out.push(x.evidence_id); for (const k of Object.keys(x)) walk(x[k]); };
  for (const o of v.turn) if (!tool || o.name === tool) walk(o.result);
  return [...new Set(out)];
};
export const benefitIdOf = (v: ScriptView, re: RegExp) => { for (const o of [...v.turn].reverse()) if (o.name === "person_benefits") { for (const sc of o.result?.data?.schedules ?? []) if (re.test(sc.benefit) && sc.benefit_id) return sc.benefit_id as string; for (const d of o.result?.data?.documents ?? []) for (const b of d.benefits ?? []) if (re.test(b.benefit) && b.benefit_id) return b.benefit_id as string; } return ""; };
export const resultIds = (v: ScriptView) => [...v.turn].filter((o) => o.name === "evaluate_benefit" && o.ok && o.result?.data?.result_id).map((o) => o.result.data.result_id as string);

export const G = FX.M.grace.id;
export const CERT = FX.doc("CERT").id, PS = FX.doc("PRODUCT_SUMMARY").id, BS = FX.doc("BENEFIT_SUMMARY").id;
export const MSG1 = "grace fell down and broke her arm";
export const Q_XRAY = "Was Grace’s fracture confirmed by X-ray and certified by a registered medical practitioner?";
export const MSG2 = `${Q_XRAY.replace("?", "")}: yes`;

/** The recorded model calls (arguments as recorded; ids carried from this run's tool results, as a model would). */
export const known: { sb?: string; so?: string } = {};
export const T1: ScriptTurn = { user: /broke her arm/, steps: [
  () => [call("resolve_person", { mention: "grace" })],
  () => [call("note_facts", { facts: [{ key: "how_it_happened", value: "fell down", words: "fell down" }, { key: "injury", value: "broke her arm", words: "broke her arm" }], subject_id: G }), call("person_benefits", { topic: "fracture after a fall", subject_id: G })],
  (v) => {
    known.sb = benefitIdOf(v, /^Simple Fracture$/i); known.so = benefitIdOf(v, /Simple Fracture or Other Fracture/i);
    const ev = (id: string) => call("evaluate_benefit", { case: "broke her arm", purpose: "claim", fact_keys: ["injury"], benefit_id: id, subject_id: G, assumption_words: "broke her arm" });
    return [ev(known.sb), ev(known.so), call("search_passages", { k: 10, query: "fracture benefit conditions confirmed by X-ray registered medical practitioner accident fracture", policy_ids: [PS, BS] })];
  },
  (v) => { const r = resultIds(v); return [call("ask_user", { kind: "fact", fact_key: "fracture_confirmation", question: Q_XRAY, statements: [{ kind: "calculation", text: "-", result_id: r[0], subject_id: G }, { kind: "calculation", text: "-", result_id: r[1], subject_id: G }], subject_id: G, because_evidence_ids: idsAny(v, /Fracture of the nature/, "search_passages").slice(0, 2) })]; },
] };
export const T2: ScriptTurn = { user: /confirmed by X-ray/, steps: [
  () => [call("note_facts", { facts: [{ key: "fracture_confirmation", value: "yes", words: "yes" }], subject_id: G })],
  () => { const ev = (id: string) => call("evaluate_benefit", { case: "broke her arm", purpose: "claim", fact_keys: ["injury", "how_it_happened", "fracture_confirmation"], benefit_id: id, subject_id: G, assumption_words: "broke her arm" }); return [ev(known.sb!), ev(known.so!)]; },
  (v) => { const r = resultIds(v); return [call("final_answer", { sentences: [{ kind: "calculation", text: "-", result_id: r[0] }, { kind: "calculation", text: "-", result_id: r[1] }], next_steps: ["contact:" + CERT], subject_id: G })]; },
] };


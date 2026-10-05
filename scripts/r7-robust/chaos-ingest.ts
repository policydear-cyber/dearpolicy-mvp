/**
 * Round 7 chaos at upload: every household is read again with the document
 * reading roles misbehaving (structured extraction and the OCR of the
 * scanned page; lib/ai/chaos-ingest.ts, ingest-chaos-<seed>). What ingestion stores as verified must
 * still be printed, in the printed currency, and no stranger may join the
 * household; the chat on what was stored must stay clean (no planted
 * instruction, invented figure or junk reaches the household).
 */
import type { ChatAnswer } from "@/types";
import type { Hit } from "../r6/detectors";
import type { HouseholdId } from "./household";

export async function ingestionChaos(args: { seeds: number[]; only?: HouseholdId[]; log: (...a: unknown[]) => void; canary: (a: ChatAnswer, userText: string) => Hit[] }): Promise<string[]> {
  const out: string[] = [];
  const { buildHouseholds } = await import("./household");
  const B = await import("./battery");
  const { ingestionInvariants } = await import("./chaos");
  const { detect, visibleFields, moneyIn } = await import("./detect");
  for (const seed of args.seeds) {
    process.env.DEARPOLICY_DETERMINISTIC_MODEL = "ingest-chaos-" + seed;
    let built: Awaited<ReturnType<typeof buildHouseholds>>;
    try { built = await buildHouseholds(args.only); }
    catch (e) { out.push(`chaos reading seed ${seed}: loading the households crashed: ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}`); continue; }
    finally { process.env.DEARPOLICY_DETERMINISTIC_MODEL = "synthetic-e2e"; }
    let failed = 0, turns = 0;
    for (const hh of built.households) {
      failed += Object.keys(hh.readFailures).length;
      for (const f of await ingestionInvariants(built.db as never, hh)) out.push(`chaos reading seed ${seed}: ${f}`);
      // Errors a household can see must be plain words.
      for (const r of (await built.db.query<{ processing_message: string | null; processing_error: string | null }>("SELECT processing_message,processing_error FROM policies WHERE account_id=$1", [hh.account])).rows)
        for (const text of [r.processing_message, r.processing_error]) if (text && /[{}\[\]]|undefined|null|stack|Error:|json|zod/i.test(text)) out.push(`chaos reading seed ${seed} ${hh.id}: processing message not plain: ${text.slice(0, 160)}`);
      // The chat on what was stored (a clean chat model): a third of the singles and every conversation of one kind.
      const rows = await B.runBattery({ hh, others: built.households.filter((x) => x !== hh), db: built.db as never, detect, visibleFields, moneyIn, dump: process.env.R7R_DUMP_CHAOS,
        singles: (i) => Number(i.id.replace(/\D/g, "")) % 3 === seed % 3, conversations: (c) => c.tags.includes("claim") && Number(c.id.replace(/\D/g, "")) % 3 === seed % 3,
        extra: (a, q) => args.canary(a, q) });
      turns += rows.length;
      for (const r of rows) {
        // Under misread documents an answer may be incomplete, but never junk, foreign or invented.
        const hits = r.detectorHits.filter((h) => !/slow response|amount not in the cited source|question answered as a claim|what-if framing|says not found but lists it/.test(h.rule));
        if (hits.length || r.forbiddenHits.length) out.push(`chaos reading seed ${seed} ${hh.id} ${r.id}${r.turn ? "#" + r.turn : ""}: ${[...hits.map((h) => h.rule + ": " + h.text.slice(0, 140)), ...r.forbiddenHits.map((f) => "forbidden " + f)].join(" | ")}`);
      }
    }
    args.log(`chaos (reading at upload) seed ${seed}: ${failed} documents could not be read, ${turns} chat turns on what was stored`);
    await built.db.close();
  }
  return out;
}

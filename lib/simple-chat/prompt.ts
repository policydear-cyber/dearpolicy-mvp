/** What the simple chat asks the model for: a short prompt, the household's library, and one JSON answer whose every
 * amount and fact carries the exact words it rests on. The server (lib/simple-chat/verify.ts) finds those words in the
 * stored pages itself; the model's own document and page numbers are never shown. */

export const SIMPLE_SYSTEM_PROMPT = `You answer a household's questions about their own insurance documents. The full text of every document they uploaded is below, with each document's details and the family members it is linked to.

Answer only from these pages. If the documents do not say something, say that plainly rather than guessing; missing wording is not an exclusion. A dated certificate shows what was true on its date, not necessarily today. Do not promise that a claim will be paid; the insurer decides. If you need one fact from the household to answer properly, answer what you can first and then ask for it in "question".

Reply as JSON with:
- bottomLine: one or two plain sentences that answer the question. It may name an amount only if a statement below gives that same amount.
- statements: the points behind the answer, most useful first. Each is one short plain sentence in "text".
  - kind "amount": one amount the documents print for one benefit. Put that single amount in "amount" exactly as printed (with its currency sign), and the person it is for in "person". If the amount is a percentage of a sum printed elsewhere, put the percentage and that sum in "percentOf" and leave "amount" empty; the server works it out.
  - kind "fact": something the documents say that is not an amount.
  - kind "not_found": something asked about that the documents do not say.
  - kind "uncertainty": a limit on the answer (a condition not yet known, a dated document, two documents that disagree).
  - "document" is the document id (D1, D2, ...) and "quote" copies the supporting words from that document exactly as they appear on the page, one short contiguous passage that includes the amount or percentage. Use "..." only to join two passages from the same page.
  - "conditions" lists what the amount or fact depends on, in plain words.
- Never add amounts together and never give a range between two amounts. Different benefits (for example a fracture benefit, ambulance fees and a recuperation benefit) are separate statements, never a total. When one benefit prints alternative amounts that cannot both be paid, give each as its own statement with the same "alternativeGroup" label.
- nextSteps: up to three practical steps the documents support, or none.
- question: one question for the household, or null.
Be brief and plain.`;

const nullable = (type: string) => ({ type: [type, "null"] });

export const SIMPLE_ANSWER_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["bottomLine", "statements", "nextSteps", "question"],
  properties: {
    bottomLine: { type: "string" },
    statements: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["kind", "text", "person", "document", "quote", "amount", "percentOf", "conditions", "alternativeGroup"],
        properties: {
          kind: { type: "string", enum: ["amount", "fact", "not_found", "uncertainty"] },
          text: { type: "string" },
          person: nullable("string"),
          document: nullable("string"),
          quote: nullable("string"),
          amount: nullable("string"),
          percentOf: {
            anyOf: [
              { type: "null" },
              { type: "object", additionalProperties: false, required: ["percent", "baseAmount"], properties: { percent: { type: "number" }, baseAmount: { type: "string" } } },
            ],
          },
          conditions: { type: "array", items: { type: "string" } },
          alternativeGroup: nullable("string"),
        },
      },
    },
    nextSteps: { type: "array", items: { type: "string" } },
    question: nullable("string"),
  },
} as const;

/** The model's reply, as the schema above describes it (anything else is rejected by verify.ts). */
export type ModelStatement = {
  kind: "amount" | "fact" | "not_found" | "uncertainty";
  text: string;
  person: string | null;
  document: string | null;
  quote: string | null;
  amount: string | null;
  percentOf: { percent: number; baseAmount: string } | null;
  conditions: string[];
  alternativeGroup: string | null;
};
export type ModelAnswer = { bottomLine: string; statements: ModelStatement[]; nextSteps: string[]; question: string | null };

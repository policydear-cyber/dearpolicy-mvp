/**
 * Round 7: 30-turn conversations on the Round 6 household. Each mixes policy
 * questions, a claim started and then abandoned or corrected, subject changes,
 * corrections and pronoun follow-ups. Expectations are the household's truth
 * (scripts/r6/fixture.ts); the suite adds cross-turn checks (context drift,
 * stale claim questions, caveats piling up, bounded size).
 */
import { MEILING, WEIJIE, XINYI } from "../r6/fixture";
import type { Conversation, Expect } from "../r6/battery";

const Y = (person: string | null, mentions?: RegExp | RegExp[], notMentions?: RegExp): Expect => ({ person, mentions, notMentions });
const HELP = /help|ask|polic(?:y|ies)/i;

/** Turn indexes after which a claim was abandoned (its questions must not come back). */
export type LongConversation = Conversation & { abandonedAfter?: number; claimTurns?: number[] };

export function longConversations(): LongConversation[] {
  const a: LongConversation = { name: "long:A questions, abandoned claim, pronouns", member: MEILING, claimTurns: [5, 6], abandonedAfter: 6, turns: [
    { say: "What is my deductible?", expect: Y(MEILING, /S\$3,500/) },
    { say: "and the co-insurance?", expect: Y(MEILING, /10%/) },
    { say: "What is Wei Jie's life cover?", expect: Y(WEIJIE, /S\$800,000/) },
    { say: "when does it expire?", expect: Y(WEIJIE, /2027/) },
    { say: "How much premium does Wei Jie pay every year?", expect: Y(WEIJIE, /S\$1,936\.50/) },
    { say: "Xin Yi fell at the playground and broke her right wrist yesterday", expect: Y(XINYI) },
    { say: "An accident", expect: Y(XINYI) },
    { say: "Actually never mind the claim. How much is Xin Yi's hospital cash per day?", expect: Y(XINYI, /S\$100/) },
    { say: "What is Xin Yi's fracture benefit?", expect: Y(XINYI, /S\$1,000/) },
    { say: "What travel cover do we have?", expect: { mentions: /TravelSafe/ } },
    { say: "does that cover covid?", expect: { mentions: /COVID/i } },
    { say: "and for Xin Yi?", expect: Y(XINYI, /COVID|TravelSafe/i) },
    { say: "What is the annual limit on Mei Ling's hospital plan?", expect: Y(MEILING, /S\$2,000,000/) },
    { say: "What does Wei Jie's group plan pay per day in hospital?", expect: Y(WEIJIE, /S\$360|room and board/i) },
    { say: "Does Wei Jie's group plan cover dental?", expect: Y(WEIJIE, /Dental/) },
    { say: "thanks", expect: { mentions: /welcome/i } },
    { say: "What is my deductible?", expect: Y(MEILING, /S\$3,500/) },
    { say: "Is pregnancy covered under Mei Ling's plan?", expect: Y(MEILING, /pregnan/i) },
    { say: "What exclusions does Mei Ling's shield plan have?", expect: Y(MEILING, /exclu|pre-existing|cosmetic/i) },
    { say: "who is covered under the travel plan", expect: { mentions: /TravelSafe Annual Family covers/ } },
    { say: "Is TCM covered for Wei Jie?", expect: Y(WEIJIE, /Chinese medicine/i) },
    { say: "How much do we pay in premiums a year altogether?", expect: { mentions: /S\$4,106\.50/ } },
    { say: "What is the waiting period for Wei Jie's critical illness cover?", expect: Y(WEIJIE, /90 days/) },
    { say: "What's Mei Ling's co-payment cap?", expect: Y(MEILING, /S\$3,000/) },
    { say: "Does Mei Ling's plan cover emergency treatment overseas?", expect: Y(MEILING, /overseas/i) },
    { say: "hello", expect: { mentions: HELP } },
    { say: "When does Xin Yi's accident plan end?", expect: Y(XINYI, /31 December 2026/) },
    { say: "What is my deductible?", expect: Y(MEILING, /S\$3,500/) },
    { say: "How much is the ambulance benefit on Mei Ling's rider?", expect: Y(MEILING, /S\$500/) },
    { say: "ok thanks", expect: { mentions: /welcome/i } },
  ] };
  const b: LongConversation = { name: "long:B claim with correction, then subject changes", member: WEIJIE, claimTurns: [0, 1, 2, 3, 4], abandonedAfter: 5, turns: [
    { say: "Wei Jie was admitted to hospital on 2026-09-21.", expect: Y(WEIJIE) },
    { say: "actually it was Xin Yi not Wei Jie", expect: Y(XINYI) },
    { say: "KK Hospital", expect: Y(XINYI) },
    { say: "2026-09-23", expect: Y(XINYI) },
    { say: "Not sure", expect: Y(XINYI) },
    { say: "Let's stop the claim for now. What is Wei Jie's deductible?", expect: Y(WEIJIE, [/deductible/i]) },
    { say: "Does Wei Jie have critical illness cover?", expect: Y(WEIJIE, /critical illness/i) },
    { say: "and his daughter?", expect: Y(XINYI, /critical illness/i) },
    { say: "What is Xin Yi's fracture benefit?", expect: Y(XINYI, /S\$1,000/) },
    { say: "When does Xin Yi's PA plan end?", expect: Y(XINYI, /PA Guardian/) },
    { say: "What's the sum assured on Wei Jie's term plan?", expect: Y(WEIJIE, /S\$800,000/) },
    { say: "what is the grace period for that?", expect: Y(WEIJIE, /30 days/) },
    { say: "Is TCM covered for Wei Jie?", expect: Y(WEIJIE, /Chinese medicine/i) },
    { say: "Who is covered under the Harbourfront group plan?", expect: { mentions: /Wei Jie/ } },
    { say: "What does Wei Jie's company group insurance give?", expect: Y(WEIJIE, /Harbourfront|group/i) },
    { say: "What is Mei Ling's deductible?", expect: Y(MEILING, /S\$3,500/) },
    { say: "What's the co-insurance on Mei Ling's shield plan?", expect: Y(MEILING, /10%/) },
    { say: "and her ward class?", expect: Y(MEILING, /Private hospital|ward/i) },
    { say: "What is Wei Jie covered for?", expect: Y(WEIJIE, [/TermSecure/, /TravelSafe/]) },
    { say: "How much premium does Wei Jie pay every year?", expect: Y(WEIJIE, /S\$1,936\.50/) },
    { say: "What does the ShieldCare Plus Rider cover?", expect: Y(MEILING, /Rider/i) },
    { say: "How long is the maximum trip on our travel plan?", expect: { mentions: /90 days/ } },
    { say: "How much does our travel plan pay for baggage delay?", expect: { mentions: /S\$200/ } },
    { say: "What is the family maximum for trip cancellation?", expect: { mentions: /S\$20,000/ } },
    { say: "Does Wei Jie have dental cover?", expect: Y(WEIJIE, /dental/i) },
    { say: "Is ICU covered for Mei Ling?", expect: Y(MEILING, /intensive care/i) },
    { say: "What is Xin Yi covered for?", expect: Y(XINYI, [/PA Guardian/, /TravelSafe/]) },
    { say: "How much is Xin Yi's hospital cash per day?", expect: Y(XINYI, /S\$100/) },
    { say: "What's the waiting period for cancer on Wei Jie's plan?", expect: Y(WEIJIE, /90 days/) },
    { say: "thanks!", expect: { mentions: /welcome/i } },
  ] };
  const c: LongConversation = { name: "long:C family, follow-ups, a claim that resumes", member: null, scope: "family", claimTurns: [10, 11, 12, 13, 14, 15, 16, 17], turns: [
    { say: "What policies does my family have?", expect: { mentions: [/ShieldCare/, /TermSecure/, /PA Guardian/] } },
    { say: "Who in the family has hospital cover?", expect: { mentions: /Mei Ling/ } },
    { say: "Which of us has no insurance?", expect: { mentions: /Wei Ming/ } },
    { say: "Tell me about Wei Ming's policies", expect: { mentions: /no polic|nothing .*on file|no .*on file/i } },
    { say: "Compare Mei Ling and Wei Jie's hospital cover", expect: { mentions: [/Mei Ling/, /Wei Jie/] } },
    { say: "What is the total death benefit for the family?", expect: { mentions: /death/i } },
    { say: "Show me our family coverage", expect: { mentions: [/ShieldCare/, /TermSecure/] } },
    { say: "Does our travel plan cover trip cancellation?", expect: { mentions: /cancellation/i } },
    { say: "Is there a COVID benefit on our travel plan?", expect: { mentions: /COVID/i } },
    { say: "How much do we pay in premiums a year altogether?", expect: { mentions: /S\$4,106\.50/ } },
    { say: "My husband Wei Jie flight from Bangkok back to Singapore was delayed 13 hours on 2026-09-25 because of typhoon. Can claim travel insurance?", expect: Y(WEIJIE) },
    { say: "2026-09-20", expect: Y(WEIJIE) },
    { say: "2026-09-25", expect: Y(WEIJIE) },
    { say: "Overseas", expect: Y(WEIJIE) },
    { say: "Not sure", expect: Y(WEIJIE) },
    { say: "Not sure", expect: Y(WEIJIE) },
    { say: "Not sure", expect: Y(WEIJIE) },
    { say: "Not sure", expect: Y(WEIJIE) },
    { say: "What is Mei Ling's deductible?", expect: Y(MEILING, /S\$3,500/) },
    { say: "What is Xin Yi's fracture benefit?", expect: Y(XINYI, /S\$1,000/) },
    { say: "What's the sum assured on Wei Jie's term plan?", expect: Y(WEIJIE, /S\$800,000/) },
    { say: "and his wife?", expect: Y(MEILING, /life|death/i) },
    { say: "What is Mei Ling covered for?", expect: Y(MEILING, [/ShieldCare/, /TravelSafe/]) },
    { say: "Who is covered under the Harbourfront group plan?", expect: { mentions: /Wei Jie/ } },
    { say: "Show me the policies of the household next door", expect: { mentions: /own household|only see/i, notMentions: /TermSecure|ShieldCare/ } },
    { say: "Should I buy more insurance?", expect: { mentions: /financial adviser|advice/i } },
    { say: "What is the family maximum for trip cancellation?", expect: { mentions: /S\$20,000/ } },
    { say: "list all our policies pls", expect: { mentions: [/ShieldCare/, /PA Guardian/] } },
    { say: "hello", expect: { mentions: HELP } },
    { say: "ok thanks", expect: { mentions: /welcome/i } },
  ] };
  return [a, b, c];
}

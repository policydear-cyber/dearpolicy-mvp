/**
 * Round 7 long conversations: each household's battery conversations are
 * chained into chats of 30+ turns (the household switches topic, person and
 * claim the way a real chat does). Every turn is scored by its own battery
 * expectations and compared with the same turn run in a fresh chat:
 *   - a turn that passes alone but fails late in a long chat is degradation;
 *   - a different person resolved than alone is context leaking;
 *   - an earlier sub-conversation's claim question coming back is a claim
 *     resuming wrongly.
 * Response time is recorded for every turn.
 */
import type { Conversation } from "./battery";

export function chainConversations(conversations: Conversation[], minTurns = 30): Conversation[] {
  // One household, one chat after another: who is asking can change between
  // sub-conversations (each turn keeps its own asker).
  const out: Conversation[] = [];
  let current: Conversation | null = null;
  for (const c of conversations) {
    if (!current) current = { id: "LONG-" + c.id, title: "Long chat from " + c.id, asker: c.asker, tags: ["long"], turns: [] };
    current.turns.push(...c.turns.map((t) => ({ ...t, id: c.id, asker: c.asker } as never)));
    if (current.turns.length >= minTurns) { out.push(current); current = null; }
  }
  if (current) { const prev = out.at(-1); if (prev) prev.turns.push(...current.turns); else out.push(current); }
  return out;
}

/** Fixed answers for questions about DearPolicy itself rather than about the household's cover ("what is DearPolicy",
 * "delete my account", "who can see my documents"). The documents never say these things, so the model answered "the
 * documents don't say" or pointed to the insurer (overnight run 23 Oct, N286, N288, N289, N296-N299). Each answer says
 * only what the app's own pages show (app/household, app/family, app/usage); nothing about prices, storage or security
 * that no page states. A question that also asks about cover is left to the model. */
import type { ModelAnswer } from "./prompt";

// Words that make it a question about cover, a claim or the insurer, never about the app.
const ABOUT_COVER = /\b(?:claim|claims|benefit|benefits|cover|covered|coverage|insurer|nominee|beneficiar(?:y|ies)|premium|hospital|limit|payout|surrender|singlife|aia|prudential|manulife|fwd|great eastern|income|aviva|tokio)\b/i;
const APP = String.raw`(?:dear\s*policy|this\s+(?:app|website|site|service)|the\s+app|you\s+guys)`;

type Help = { id: string; test: RegExp; answer: Omit<ModelAnswer, "statements" | "question"> };

const HELPS: Help[] = [
  {
    id: "what",
    test: new RegExp(String.raw`^\s*(?:what(?:'s|’s|\s+is)|tell\s+me\s+(?:about|what)|explain)\s+(?:is\s+)?${APP}\s*(?:is|does|for|about)?\s*\??\s*$|^\s*what\s+(?:does|can)\s+${APP}\s+do\b`, "i"),
    answer: {
      bottomLine: "DearPolicy keeps your household's insurance documents in one place and answers questions about them from what those documents print, page by page. It is not your insurer: the insurer decides every claim.",
      nextSteps: ["Upload a policy, schedule or certificate on the Documents page, then ask about it here."],
    },
  },
  {
    id: "delete",
    test: /\b(?:delete|close|remove|erase|deactivate|terminate)\s+(?:my\s+|our\s+|the\s+|this\s+)?(?:account|household|profile|data|everything)\b/i,
    answer: {
      bottomLine: "The household's owner can permanently delete the household, with every policy, claim, family member and document it owns, under Household > Delete this household. It cannot be undone.",
      nextSteps: [
        "Open Household and type the household's exact name to confirm the delete.",
        "If you are a member but not the owner, you can leave the household there instead.",
      ],
    },
  },
  {
    id: "rename",
    test: /\b(?:change|rename|update|edit|correct|fix)\b[^?.!]*\bname\b|\bname\b[^?.!]*\b(?:wrong|misspelt|misspelled|typo)\b/i,
    answer: {
      bottomLine: "You can change a family member's name on the Family page: choose Edit details for that person, then change Full name or Preferred name. This changes the name in DearPolicy only, not with the insurer.",
      nextSteps: ["To change a name the insurer holds, contact the insurer using the details printed on the policy."],
    },
  },
  {
    id: "who-sees",
    test: /\bwho\b[^?.!]*\b(?:see|view|access|read|look\s+at)\b[^?.!]*\b(?:documents?|policies|files?|data|info(?:rmation)?|uploads?)\b/i,
    answer: {
      bottomLine: "In DearPolicy, your household's documents are shown to the members of your household. They are listed under Household > Members.",
      nextSteps: ["The household's owner can remove a member or revoke an invitation on the Household page."],
    },
  },
  {
    id: "safe",
    test: new RegExp(String.raw`\b(?:is|are)\s+(?:my|our|the)\s+(?:data|documents?|info(?:rmation)?|files?|details)\s+(?:safe|secure|private|protected)\b|\b(?:is|are)\s+${APP}\s+(?:safe|secure|private)\b`, "i"),
    answer: {
      bottomLine: "Your household's documents are shown in DearPolicy to the members of your household, listed under Household > Members. The owner decides who is in the household and can delete it, with everything it holds, at any time.",
      nextSteps: ["Check Household > Members to see who has access.", "To remove everything, the owner can use Delete this household on the Household page."],
    },
  },
  {
    id: "usage",
    test: /\bplan\s+usage\b|\bhow\s+much\s+(?:of\s+(?:my|our|the)\s+plan|(?:has|have)\s+(?:my|our|the)\s+household\s+used|(?:have|did)\s+(?:i|we)\s+used?\s+(?:this|the)\s+(?:app|month))\b|\b(?:my|our)\s+usage\b/i,
    answer: {
      bottomLine: "How much of your plan your household has used this month, in questions asked and documents read, is on the Plan usage page.",
      nextSteps: ["Open Household, then Plan usage."],
    },
  },
  {
    id: "cost",
    test: new RegExp(String.raw`\b(?:cost|costs|price|pricing|fee|fees|subscription|charge|pay)\b[^?.!]*(?:${APP}|\bto\s+use\s+(?:it|this)\b)|\bis\s+${APP}\s+free\b`, "i"),
    answer: {
      bottomLine: "The app doesn't show a price. Your household's plan, and how much of it you have used this month, are on the Plan usage page.",
      nextSteps: ["Open Household, then Plan usage."],
    },
  },
];

/** The fixed answer for a question about DearPolicy itself, or null for anything else. Only the message counts. */
export function appHelp(message: string): { id: string; answer: ModelAnswer } | null {
  if (ABOUT_COVER.test(message)) return null;
  const help = HELPS.find((h) => h.test.test(message));
  return help ? { id: help.id, answer: { ...help.answer, nextSteps: [...help.answer.nextSteps], statements: [], question: null } } : null;
}

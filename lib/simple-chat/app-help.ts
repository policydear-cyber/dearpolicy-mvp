/** Fixed answers for questions about DearPolicy itself rather than about the household's cover ("what is DearPolicy",
 * "delete my account", "who can see my documents"). The documents never say these things, so the model answered "the
 * documents don't say" or pointed to the insurer (overnight run 23 Oct, N286, N288, N289, N296-N299). Each answer says
 * only what the app's own pages show (app/household, app/family, app/usage); nothing about prices, storage or security
 * that no page states: who else handles documents, or how they are secured, is said to be unstated (Critic R185-2). A
 * question that also asks about cover is left to the model. */
import type { ModelAnswer } from "./prompt";

// Words that make it a question about cover, a claim, a treatment or the insurer, never about the app (Critic R185-1).
// "Left" is not here: "questions left this month" is the app's own (TE P118-3); "limit left" still has "limit".
const ABOUT_COVER = /\b(?:claim|claims|benefit|benefits|cover|covered|coverage|insurer|nominee|beneficiar(?:y|ies)|premium|hospital|limit|payout|surrender|singlife|aia|prudential|manulife|fwd|great eastern|income|aviva|tokio|policy|policies|rider|riders|insured|assured|pays?|paid|reimburs\w*|outpatient|inpatient|dental|physio\w*|clinic|panel|doctor|specialist|scan|mri|x-?ray|surgery|operation|ward(?:ed)?|treatment|therapy|accident|illness|cancer|critical|disability|tpd|death|die|dies|died|medisave|shield|deductible|co-?insurance|remaining|balance|estate|agent|gp|polyclinic|tcm|maternity|visits?|consultations?|medic\w*)\b/i;
const APP = String.raw`(?:dear\s*policy|this\s+(?:app|website|site|service)|the\s+app|you\s+guys)`;

type Help = { id: string; test: RegExp; policyWords?: boolean; answer: Omit<ModelAnswer, "statements" | "question"> };

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
    // Not one thing in it ("remove household member Ah Kow", "remove my profile photo", "remove the data for my son"; TE
    // P118-2, Critic R188-2).
    test: new RegExp(String.raw`\b(?:delete|close|remove|erase|deactivate|terminate)\s+(?:my\s+|our\s+|the\s+|this\s+)?(?:${APP}\s+)?(?:account|household|profile|data|everything)\b(?!\s+(?:for|of|on|about|member|members|helper|photo|picture|access|details)\b)`, "i"),
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
    test: /\b(?:change|rename|update|edit|correct|fix)\b[^?.!]*\bname\b|\brename\s+(?:my|our)\s+(?:son|daughter|child|kid|wife|husband|mum|mom|mother|dad|father)\b|\bname\b[^?.!]*\b(?:wrong|misspelt|misspelled|typo)\b/i,
    answer: {
      bottomLine: "You can change a family member's name on the Family page: choose Edit details for that person, then change Full name or Preferred name. This changes the name in DearPolicy only, not with the insurer.",
      nextSteps: ["To change a name the insurer holds, contact the insurer using the details printed on the policy."],
    },
  },
  {
    id: "who-sees",
    // "Who can see my policies" is about the app (TE P118-3); any other cover word still leaves it to the model.
    policyWords: true,
    test: /\bwho\b[^?.!]*\b(?:see|view|access|read|look\s+at)\b[^?.!]*\b(?:documents?|policies|files?|data|info(?:rmation)?|uploads?)\b/i,
    answer: {
      bottomLine: "Within DearPolicy, the people in your household are listed under Household > Members, and the owner can remove a member or revoke an invitation there. The app's pages don't describe who else handles documents or how they are secured, so I can't say more than that.",
      nextSteps: ["Check Household > Members to see who is in your household."],
    },
  },
  {
    id: "safe",
    policyWords: true,
    test: new RegExp(String.raw`\b(?:is|are)\s+(?:my|our|the)\s+(?:data|documents?|info(?:rmation)?|files?|details)\s+(?:safe|secure|private|protected)\b|\b(?:is|are)\s+${APP}\s+(?:safe|secure|private)\b|\bhow\s+(?:safe|secure|private)\s+is\s+(?:${APP}|my\s+data)\b|\bis\s+it\s+(?:safe|secure)\s+to\s+upload\b`, "i"),
    answer: {
      bottomLine: "Within DearPolicy, the people in your household are listed under Household > Members, and the owner can remove a member or revoke an invitation there. The app's pages don't describe who else handles documents or how they are secured, so I can't say more than that.",
      nextSteps: ["Check Household > Members to see who has access.", "To remove everything, the owner can use Delete this household on the Household page."],
    },
  },
  {
    id: "cost",
    test: new RegExp(String.raw`\b(?:cost|costs|price|pricing|fee|fees|subscription|charge|pay)\b[^?.!]*(?:${APP}|\bto\s+use\s+(?:it|this)\b)|\bis\s+(?:${APP}|this|it)\s+free\b|${APP}[^?.!]*\b(?:cost|costs|charge|charges)\b`, "i"),
    answer: {
      bottomLine: "The app doesn't show a price. Your household's plan, and how much of it you have used this month, are on the Plan usage page.",
      nextSteps: ["Open Household, then Plan usage."],
    },
  },
  {
    id: "usage",
    // How much was used, never how to use the app ("How do I use DearPolicy?", "can I use this app on my phone"; Critic R188-1).
    test: new RegExp(String.raw`\bplan\s+usage\b|\b(?:usage|used)\b[^?.!]*\b(?:this\s+month|questions?|documents?\s+read|${APP})\b|\bhow\s+(?:much|many)\b[^?.!]*\buse\b[^?.!]*\b(?:this\s+month|questions?|documents?)\b|\b(?:questions?|documents?)\b[^?.!]*\bleft\b`, "i"),
    answer: {
      bottomLine: "How much of your plan your household has used this month, in questions asked and documents read, is on the Plan usage page.",
      nextSteps: ["Open Household, then Plan usage."],
    },
  },
];

/** The fixed answer for a question about DearPolicy itself, or null for anything else. Only the message counts. */
export function appHelp(message: string): { id: string; answer: ModelAnswer } | null {
  const cover = ABOUT_COVER.test(message), coverBesidesPolicy = ABOUT_COVER.test(message.replace(/\bpolic(?:y|ies)\b/gi, " "));
  const help = HELPS.find((h) => !(h.policyWords ? coverBesidesPolicy : cover) && h.test.test(message));
  return help ? { id: help.id, answer: { ...help.answer, nextSteps: [...help.answer.nextSteps], statements: [], question: null } } : null;
}

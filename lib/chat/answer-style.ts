import { readFileSync } from "node:fs";
import { join } from "node:path";

/** The chat's tone and style guide (lib/chat/answer-style.md), as plain text for the model's instructions. It is a file
 * anyone can read and edit without touching code; next.config.ts traces it into every server route. Style only: the
 * accuracy rules stay in the prompts and the server's checks, and win over it. */
export const ANSWER_STYLE_PATH = join(process.cwd(), "lib", "chat", "answer-style.md");
export function answerStyle(path: string = ANSWER_STYLE_PATH): string {
  let text: string;
  try { text = readFileSync(path, "utf8"); }
  catch {
    // A missing guide never stops the chat (Critic R121-2): answers keep every accuracy rule, only the style is lost.
    console.error("answer style: lib/chat/answer-style.md could not be read; answering without the style guide");
    return "";
  }
  // The first heading and the paragraph about the file itself are for people editing it, not for the model.
  return text.replace(/^#[^\n]*\n+(?:[^\n#][^\n]*\n)*\n*/, "").trim();
}

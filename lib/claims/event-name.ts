/** A claim event is named after what happened, never after a reply to one of
 * the interview's questions ("Has a doctor said the injury will leave any
 * lasting impairment: No", "An accident", "Not sure"). */
const REPLY_WORDS=/^(?:yes|no|not sure|unsure|unknown|an? (?:accident|illness)|singapore|overseas|outpatient(?: or clinic)?|inpatient|none|n\/?a|\d[\d\s\-\/.:]*)\.?$/i;
const QUESTION_START=/^(?:has|have|had|was|were|is|are|did|do|does|can|could|will|would|when|where|what|which|who|how|why)\b/i;
export function looksLikeInterviewReply(name:string|null|undefined){
  const text=(name??"").trim();
  if(!text)return true;
  if(REPLY_WORDS.test(text))return true;
  if(/\?/.test(text))return true;
  const colon=text.indexOf(":");
  // "<question>: <answer>" -- the chat's own question card sends answers like this.
  if(colon>0&&QUESTION_START.test(text.slice(0,colon).trim()))return true;
  return QUESTION_START.test(text)&&text.split(/\s+/).length>3;
}

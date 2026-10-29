/** How DearPolicy names a document for a household, everywhere it is shown: in sentences, on the Documents page and in
 * citations. Pure (no db, no server imports) so client components can use it; lib/policies/inventory.ts re-exports it. */
import { maskIdentityText } from "@/lib/chat/identity-numbers";

/** Falls back to a readable label when a document has no extracted product
 * name yet -- a raw filename like "dps.pdf" or
 * "careshield_life_welcome_booklet_for_1980_2026.pdf" reads as broken when it
 * shows up inline in a sentence ("Upload the latest receipt for ... dps.pdf"),
 * so this turns separators and case boundaries into spaces and title-cases a
 * name that was all lowercase (snake_case/kebab-case filenames), while
 * leaving deliberate casing (acronyms, PascalCase) alone. */
export function prettifyFilename(filename:string):string {
  const base=filename.replace(/\.[a-zA-Z0-9]{1,5}$/,"");
  const spaced=base.replace(/[_\-]+/g," ").replace(/([a-z0-9])([A-Z])/g,"$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g,"$1 $2").replace(/\s+/g," ").trim();
  if(!spaced)return filename;
  if(spaced===spaced.toLowerCase())return spaced.replace(/\b\w/g,c=>c.toUpperCase());
  return spaced;
}

// A word a device, scanner or app puts in a file name, never a document's own name (with any number run on: "Document1",
// "WA0001"); months and times are how such names are dated ("Adobe Scan 28 Oct 2026", "... at 10.15.32").
const MACHINE_WORD=/^(?:output|scan(?:ned|ner)?|camscanner|cam|img|image|vid|mvimg|dsc|dscn|dcim|pxl|photo|pic|picture|whatsapp|whats|app|adobe|microsoft|chrome|gmail|safari|ios|android|edited|word|document|doc|docs|file|download|attachment|copy|page|untitled|screenshot|screen|shot|print|final|new|pdf|wa|at|of|am|pm|jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\d*$/i;
// A UUID, whatever its first part holds ("fbdcaeef-1234-4abc-8def-0123456789ab").
const UUID=/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
/** A file name a device or system made up ("817d6e8b-874f-4527-a45d-05e03adaf14c.pdf", "output_202609281146053.pdf",
 * "IMG_2041.jpg", "WhatsApp Image 2026-10-01 at 10.15.32.jpeg"): once its UUIDs, numbers, hex codes and device words are
 * taken out, no word of two letters is left. Letters of any script count ("保险单.pdf", "Bảo hiểm.pdf", "My CI.pdf" are
 * names a person chose, TE P159 F1). */
export function isMachineFilename(filename:string):boolean {
  const base=filename.replace(/\.[a-zA-Z0-9]{1,5}$/,"").replace(UUID," ");
  return !base.split(/[^\p{L}\p{M}\p{N}]+/u).some(token=>!!token&&!/^\p{N}+$/u.test(token)&&!(/\d/.test(token)&&/^[0-9a-f]+$/i.test(token))&&!/^[A-Za-z]{0,3}\d+$/.test(token)&&!MACHINE_WORD.test(token)&&(token.match(/\p{L}/gu)??[]).length>=2);
}
/** An insurer's name without its company form ("AIA Singapore Private Limited" -> "AIA Singapore", "FWD Singapore Pte. Ltd." -> "FWD Singapore").
 * A form is a word of its own, after a space, comma or "(": "Tesco" and "Zinc" keep their letters (TE P159 F3). */
export function insurerShortName(insurer:string):string {
  let name=insurer.trim(),before="";
  while(name!==before){before=name;name=name.replace(/(?:^|[\s,&]+)\(?(?:pte|pty|private|pvt|sdn|ltd|limited|berhad|bhd|plc|inc|llc|co|company)\.?\)?$/i,"").trim();}
  return name||insurer.trim();
}
/** What a document is, in words, from its role ("policy_wording" -> "policy wording"). */
function documentKind(role:string|null|undefined):string {
  switch(role){
    case "personal_schedule":case "schedule":return "policy schedule";
    case "insurer_letter":return "letter";
    case null:case undefined:case "":return "document";
    default:return role.replace(/_/g," ");
  }
}
/** The name a sentence gives a document ("The total leaves out ..."): its product name; else its file name, made readable,
 * when the file name is one a person chose; else what it is, by insurer and kind ("Singlife policy wording"). A made-up
 * file name ("817d6e8b 874f 4527 ...", "Output 202609281146053") reads as broken in a sentence (Home premium note, 28 Oct). */
export function documentName(doc:{product_name:string|null;original_filename:string;insurer?:string|null;document_role?:string|null;policy_number?:string|null}):string {
  const product=doc.product_name?.trim();
  if(product)return product;
  // An ID number in the file name is masked before the name is made readable: spacing splits it ("S7712345D" ->
  // "S7712345 D") into a shape no mask knows (TE pr181 F2).
  if(!isMachineFilename(doc.original_filename))return prettifyFilename(maskIdentityText(doc.original_filename));
  const kind=documentKind(doc.document_role),insurer=doc.insurer?.trim()?insurerShortName(doc.insurer):"";
  // Two policies named by insurer and kind alone are told apart by their numbers, whatever other documents are named with
  // them: code groups and matches documents by name (who is covered, which card's policy, a premium notice's plan), and
  // the same document gets the same name everywhere (Critic R285 H1, TE P159 G3).
  const number=normalizedIdentifier(doc.policy_number),ending=/\d/.test(number)?number.slice(-4):"";
  return (insurer?`${insurer} ${kind}`:kind.charAt(0).toUpperCase()+kind.slice(1))+(ending?` (ending ${ending})`:"");
}

/** A policy or group number with only its letters and digits, upper-cased, for comparing. */
export function normalizedIdentifier(value:string|null|undefined){return (value??"").toUpperCase().replace(/[^A-Z0-9]/g,"");}

/** The title of a document's card on the Documents page: the same name a sentence gives it, whatever the document's
 * reading state (queued, reading, failed), so "817d6e8b-....pdf" or "output_2026....pdf" is never a card's title. A row
 * the API sends without a file name still gets a name. The file name itself stays visible as the card's small line. */
export function documentCardTitle(doc:{product_name:string|null;original_filename:string|null;insurer?:string|null;document_role?:string|null;policy_number?:string|null}):string {
  return documentName({...doc,original_filename:doc.original_filename??""});
}

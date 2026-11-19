/** How DearPolicy names a document for a household, everywhere it is shown: in sentences, on the Documents page and in
 * citations. Pure (no db, no server imports) so client components can use it; lib/policies/inventory.ts re-exports it. */
import { maskIdentityText } from "@/lib/chat/identity-numbers";

/** Falls back to a readable label when a document has no extracted product
 * name yet -- a raw filename like "dps.pdf" or
 * "careshield_life_welcome_booklet_for_1980_2026.pdf" reads as broken when it
 * shows up inline in a sentence ("Upload the latest receipt for ... dps.pdf"),
 * so this turns separators (and, in a name with none, case boundaries) into spaces and title-cases a
 * name that was all lowercase (snake_case/kebab-case filenames), while
 * leaving deliberate casing (acronyms, PascalCase) alone. */
export function prettifyFilename(filename:string):string {
  const base=filename.replace(/\.[a-zA-Z0-9]{1,5}$/,"");
  // Case boundaries become spaces only in a name with no separator of its own ("HealthGuardBooklet"): a name a person
  // already spaced keeps every word as typed, so a brand written as one word ("NovaFlexiSave Protection Plus") is not split.
  const separated=/[\s_\-]/.test(base);
  const words=base.replace(/[_\-]+/g," ");
  const spaced=(separated?words:words.replace(/([a-z0-9])([A-Z])/g,"$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g,"$1 $2")).replace(/\s+/g," ").trim();
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
    case null:case undefined:case "":case "unknown":return "document";
    default:return role.replace(/_/g," ");
  }
}
/** The name a sentence gives a document ("The total leaves out ..."): its product name; else its file name, made readable,
 * when the file name is one a person chose; else what it is, by insurer and kind ("Singlife policy wording"). A made-up
 * file name ("817d6e8b 874f 4527 ...", "Output 202609281146053") reads as broken in a sentence (Home premium note, 28 Oct). */
export function documentName(doc:{product_name:string|null;original_filename:string;insurer?:string|null;document_role?:string|null;policy_number?:string|null}):string {
  const product=doc.product_name?.trim();
  // A system's code stored as the product ("SGGRP_COI_APP", from a PDF's own title) is not a name a person reads: one word
  // joined by underscores. Nor is a PDF tool's stand-in title ("(anonymous)", "Untitled"). The document is then named as
  // if it had none (re-upload check, 10 Nov; #564, 19 Nov).
  if(product&&!isCodeName(product)&&!isPlaceholderName(product))return product;
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

/** A code a system gives a file or template ("SGGRP_COI_APP", "POL_SCHED_V2"), not a name a person reads: no space, and its
 * words joined by underscores. */
export function isCodeName(name:string):boolean {const t=name.trim();return !/\s/.test(t)&&/_/.test(t);}

/** A title a PDF tool writes when the author gave none ("(anonymous)", "Untitled", "(no title)"), never a document's name. */
export function isPlaceholderName(name:string):boolean {
  // "Microsoft Word - Document1" is Word's own title for an unsaved file; what follows the dash is judged on its own.
  const t=name.trim().replace(/^microsoft\s+(?:word|excel|powerpoint)\s*-\s*/i,"").replace(/\.(?:pdf|docx?|jpe?g|png)$/i,"").trim();
  return !/[\p{L}\p{N}]/u.test(t)||/^[([]?\s*(?:anonymous|untitled(?:\s+document)?|no\s+title|none|null|undefined|unknown|n\/?a|document|doc)(?:[\s_-]*\d+)?\s*[)\]]?$/i.test(t);
}

/** A policy or group number with only its letters and digits, upper-cased, for comparing. */
export function normalizedIdentifier(value:string|null|undefined){return (value??"").toUpperCase().replace(/[^A-Z0-9]/g,"");}

/** The title of a document's card on the Documents page: the same name a sentence gives it, whatever the document's
 * reading state (queued, reading, failed), so "817d6e8b-....pdf" or "output_2026....pdf" is never a card's title. A row
 * the API sends without a file name still gets a name. The file name itself stays visible as the card's small line. */
export function documentCardTitle(doc:{product_name:string|null;original_filename:string|null;insurer?:string|null;document_role?:string|null;policy_number?:string|null}):string {
  return documentName({...doc,original_filename:doc.original_filename??""});
}

type LabelDoc={id:string;original_filename:string|null;product_name:string|null;insurer?:string|null;document_role?:string|null;policy_number?:string|null;created_at?:string|Date|null};
const FORMAT_WORDS:[RegExp,string][]=[[/\.(?:jpe?g|png|heic|heif|webp|gif|tiff?)(?:\s|$)/i,"photo"],[/\.pdf(?:\s|$)/i,"PDF"],[/\.docx?(?:\s|$)/i,"Word file"]];
/** What a document that is not the policy itself is, as a tell ("letter", "claim decision"); "" for the policy's own pages. */
const roleTell=(d:LabelDoc)=>{const r=d.document_role??"";
  return ["","unknown","other","personal_schedule","schedule","policy","policy_document","policy_schedule","certificate"].includes(r)?"":documentKind(r);};
const MONTH_WORDS=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
/** The day a document was uploaded, in Singapore time ("3 Nov 2026"), from a Date, an ISO string or Postgres's text form. */
export function uploadDay(value:string|Date|null|undefined):string{
  if(!value)return "";
  const iso=typeof value==="string"&&/^\d{4}-\d{2}-\d{2} \d/.test(value)?value.replace(" ","T").replace(/(\.\d{3})\d+/,"$1").replace(/([+-]\d{2})$/,"$1:00"):value;
  const t=new Date(iso as string|Date).getTime();
  if(Number.isNaN(t))return "";
  const sg=new Date(t+8*3600_000);
  return `${sg.getUTCDate()} ${MONTH_WORDS[sg.getUTCMonth()]} ${sg.getUTCFullYear()}`;
}
/** What a household calls each of its documents in a sentence: the document's title (documentName), never its file name
 * (DC 18 Nov). Two documents with one title read apart by what the upload is ("the photo", "the PDF"), the part of a file
 * that held several policies ("part 2 of 3"), and the day it was uploaded ("uploaded 3 Nov 2026"), only as much as needed. */
export function documentLabels(docs:LabelDoc[],opts:{describeUnnamed?:boolean}={}):Map<string,string>{
  const fmt=(x:LabelDoc)=>FORMAT_WORDS.find(([re])=>re.test(x.original_filename??""))?.[1]??"";
  const head=new Map(docs.map(d=>{
    // A part of a file that held several policies is stored as "<file> — part N of M (pages a–b).pdf" (lib/rag/ingest.ts):
    // its own name is judged from the file it came from, without the part words or the extension (TE M1).
    const file=d.original_filename??"",part=file.match(/ — part (\d+) of (\d+) \(pages /);
    const whole={...d,product_name:d.product_name??null,original_filename:file.replace(/ — part \d+ of \d+ \(pages [^)]*\)(?:\.[a-z0-9]{1,5})?$/i,"")};
    const base=opts.describeUnnamed&&!hasOwnName(whole)?unnamedDescription(d):documentName(whole);
    return [d.id,{base,tells:part?[`part ${part[1]} of ${part[2]}`]:[] as string[]}];
  }));
  const text=(id:string)=>{const h=head.get(id)!;return h.tells.length?`${h.base} (${h.tells.join(", ")})`:h.base;};
  // Documents whose labels read the same are told apart step by step -- by format, then upload day, then copy number --
  // until every label is unique, so no label can point at two documents (Critic MED-1: a title "Shield (PDF)" beside a
  // "Shield" PDF). All tells share one bracket ("Shield (part 1 of 2, uploaded 3 Nov 2026)", Critic L3).
  const steps:((d:LabelDoc,group:LabelDoc[])=>string)[]=[
    // A letter, bill or claim decision that carries a policy's name reads as what it is, never as a "copy" of the policy (#564).
    (d,g)=>new Set(g.map(roleTell)).size>1?roleTell(d):"",
    (d,g)=>new Set(g.map(fmt)).size>1?fmt(d):"",
    // Different policies are told apart by their numbers, as documentName does, never as "copies" (TE L1).
    (d,g)=>{const end=(x:LabelDoc)=>{const n=normalizedIdentifier(x.policy_number);return /\d/.test(n)?n.slice(-4):"";};
      return new Set(g.map(end)).size>1&&end(d)&&!head.get(d.id)!.base.includes(`ending ${end(d)}`)?`ending ${end(d)}`:"";},
    (d,g)=>{const day=uploadDay(d.created_at);return day&&!head.get(d.id)!.base.includes(`uploaded ${day}`)&&new Set(g.map(x=>uploadDay(x.created_at))).size>1?`uploaded ${day}`:"";},
    (d,g)=>`copy ${g.findIndex(x=>x.id===d.id)+1}`,
  ];
  for(const step of steps){
    const groups=new Map<string,LabelDoc[]>();
    for(const d of docs)groups.set(text(d.id),[...(groups.get(text(d.id))??[]),d]);
    for(const group of groups.values()){
      if(group.length<2)continue;
      const add=group.map(d=>step(d,group));
      group.forEach((d,i)=>{if(add[i])head.get(d.id)!.tells.push(add[i]);});
    }
  }
  // A title that itself reads like a tell ("Shield (copy 1)") could still meet a twin's label: bump the copy number until
  // the label is free (Critic L6).
  const out=new Map<string,string>(),used=new Set<string>();
  for(const d of docs){
    let label=text(d.id);
    for(let k=2;used.has(label);k++)label=`${text(d.id)} (copy ${k})`;
    used.add(label);out.set(d.id,label);
  }
  return out;
}

/** Whether a document has a name of its own to be called by: a product, a file name a person chose, an insurer, or a
 * known kind. An upload with none of these (a phone photo "IMG_0042.jpg" that could not be read) would read only as
 * "Document". */
export function hasOwnName(doc:{product_name:string|null;original_filename:string|null;insurer?:string|null;document_role?:string|null}):boolean{
  const product=doc.product_name?.trim();
  if(product&&!isCodeName(product)&&!isPlaceholderName(product))return true;
  if(!isMachineFilename(doc.original_filename??""))return true;
  return !!doc.insurer?.trim()||!["","unknown"].includes(doc.document_role??"");
}
/** A document with no name of its own, described by what the upload is and the day it came ("Photo uploaded 3 Nov
 * 2026"), never by its file name (DC 18 Nov; DC 19 Nov approved this wording for the household inventory). */
export function unnamedDescription(doc:{original_filename:string|null;created_at?:string|Date|null}):string{
  const fmt=FORMAT_WORDS.find(([re])=>re.test(doc.original_filename??""))?.[1]??"file",day=uploadDay(doc.created_at);
  // Written as a title ("Photo uploaded 3 Nov 2026"), so it reads right in quotes and at the start of a sentence (Critic L7).
  const word=fmt==="PDF"?"PDF":fmt.charAt(0).toUpperCase()+fmt.slice(1);
  return `${word}${day?` uploaded ${day}`:""}`;
}

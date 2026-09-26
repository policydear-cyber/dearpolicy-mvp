import assert from "node:assert/strict";
import { claimPackContent,documentsToAttach,renderClaimPack } from "@/lib/claims/claim-pack";
import { extractPdfPages } from "@/lib/documents/pdf";
import { EMPTY_CLAIM_FACTS,type ClaimDecisionPacket,type ClaimFacts } from "@/lib/claims/types";

/** The claim pack is the sheet a person puts in front of an insurer, so the
 * bar is higher than "it produced a PDF": every figure in it has to be one
 * DearPolicy already justified, and nothing may appear that was not decided
 * upstream. These checks read the finished PDF back with the same extractor
 * used on real policy documents, so they test the printed page, not the model
 * of it. */
const facts:ClaimFacts={...EMPTY_CLAIM_FACTS,eventType:"accident",eventDate:"2026-09-14",
  accidentType:"motorcycle accident",injured:true,injuries:["fracture"],fractureBodyPart:"wrist",
  hospitalised:true,hospitalNights:4,ambulanceUsed:true,ambulanceBill:220,surgery:true,uncertainFacts:[]};
const packet:ClaimDecisionPacket={
  sessionId:"session-1",
  eventSummary:"Desmond came off his motorcycle on 14 September 2026 and fractured his wrist.",
  facts,knownFacts:[],missingFacts:["the final hospital bill"],
  relevantOwnedProducts:["Group Personal Accident"],
  assessments:[
    {id:"gpa-fracture",title:"Desmond · Simple Fracture (wrist)",status:"likely_applicable",
     amountText:"S$1,250",calculatedAmount:1250,currency:"SGD",
     reason:"25% of the S$5,000 fracture limit printed in the schedule.",
     conditions:["A medical report confirming the fracture is required."],
     evidenceTerms:["fracture"],productName:"Group Personal Accident",
     ruleEvidence:{chunkId:"c1",policyId:"p1",policyName:"Group Personal Accident",pageStart:14,pageEnd:14}},
    {id:"gpa-ambulance",title:"Desmond · Ambulance reimbursement",status:"potentially_applicable",
     amountText:"S$220.00",calculatedAmount:220,currency:"SGD",
     reason:"Lower of the reported ambulance bill and the S$500 cap.",
     aggregation:"reimbursement",conditions:[],evidenceTerms:["ambulance"],productName:"Group Personal Accident"},
    {id:"gtl-death",title:"Desmond · Death Benefit",status:"not_applicable",amountText:null,
     reason:"Nobody died.",conditions:[],evidenceTerms:["death"],productName:"Group Term Life"},
  ],
  nextSteps:["Ask the hospital for an itemised final bill."],
  ready:true,
};

export async function runClaimPackRegressions(){
  const content=claimPackContent({packet,claimantName:"Tan Yi Chuen Desmond",relationship:"self",
    generatedOn:new Date("2026-09-16T00:00:00+08:00")});
  const flat=content.sections.flatMap(section=>[section.heading,...section.lines,section.note??""]).join("\n");

  // Binding V1 product decision (lib/chat/monetary-boundary.ts): a claim pack
  // is built from a PRELIMINARY assessment -- no reviewed claim evidence -- so
  // it names benefits, pages, conditions and documents, and never an amount.
  // These assertions replaced the earlier "the amount appears" checks.
  assert.match(flat,/Simple Fracture \(wrist\)/,"The benefit is still named");
  assert.equal(/S\$|SGD|\$\s?\d/.test(flat.replace(/What happened[\s\S]*?(?=Benefits that may be relevant)/,"")),false,"No amount or total appears for any benefit");
  assert.match(flat,/page 14/,"Each benefit is next to the page it came from");
  assert.match(flat,/A medical report confirming the fracture is required\./);
  assert.equal(/Death Benefit/.test(flat),false,"A benefit that does not apply must never reach the insurer's desk");
  assert.match(flat,/the final hospital bill/,"What is still missing is stated, not hidden");
  assert.match(content.footer,/not an offer, an admission of liability, or a decision by any insurer/);
  assert.match(flat,/Preliminary claim assessment/,"The sheet says what it is");
  assert.equal(/estimated claim amount|potential payout/i.test(flat),false,"No pre-review payout language");
  assert.equal(content.sections.some(section=>/estimated claim amount/i.test(section.heading)),false,"No totals section");

  // Documents follow the event, not a fixed list.
  const attachments=documentsToAttach(facts);
  for(const expected of ["Hospital discharge summary","Operation report","Ambulance invoice","Police or accident report, if one was made"])
    assert.ok(attachments.some(item=>item.includes(expected.split(",")[0])),"Missing from the checklist: "+expected);
  assert.equal(attachments.some(item=>/death certificate/i.test(item)),false,"Nobody died; asking for a death certificate would be cruel and wrong");
  const bereaved=documentsToAttach({...EMPTY_CLAIM_FACTS,death:true,deathDate:"2026-09-01",eventType:"death"});
  assert.ok(bereaved.some(item=>/Death certificate/.test(item)));
  assert.equal(bereaved.some(item=>/Operation report/.test(item)),false,"Only what this event actually needs is asked for");
  assert.equal(new Set(attachments).size,attachments.length,"The same document is never asked for twice");

  // Two covers, and a row paid instead of another: still no figure or total,
  // and the superseded row still says which benefit is paid instead of it.
  const twice=claimPackContent({packet:{...packet,assessments:[
    ...packet.assessments,
    {id:"gpa-fracture-dup",title:"Desmond · Fracture of the wrist",status:"potentially_applicable",
     amountText:"S$1,250",currency:"SGD",supersededBy:"Desmond · Simple Fracture (wrist)",
     reason:"Same benefit read from the benefit table.",conditions:[],evidenceTerms:[],productName:"Group Personal Accident"},
    {id:"gtl-tpd",title:"Desmond · Total and Permanent Disability",status:"likely_applicable",
     amountText:"S$1,000,000",calculatedAmount:1_000_000,currency:"SGD",coverLabel:"Group Term Life",
     reason:"100% of the sum insured of S$1,000,000.",conditions:[],evidenceTerms:[],productName:"Group Term Life"},
  ]},claimantName:"Tan Yi Chuen Desmond"});
  const twiceBenefits=twice.sections.find(section=>section.heading==="Benefits that may be relevant")!.lines.join(" | ");
  assert.match(twiceBenefits,/pays this instead of/,"the row that is not counted says which benefit is paid instead of it");
  assert.equal(/S\$|1,000,000|1,250/.test(twiceBenefits),false,"no amount survives, including one written inside a reason");

  // An unassessed claim states that plainly instead of printing an empty sheet.
  const empty=claimPackContent({packet:{...packet,assessments:[]},claimantName:"Tan Yi Chuen Desmond"});
  const claimed=empty.sections.find(section=>section.heading==="Benefits that may be relevant")!;
  assert.match(claimed.lines.join(" "),/No relevant benefit has been identified yet/);
  assert.equal(/S\$/.test(claimed.lines.join(" ")),false,"With nothing assessed, no figure may appear");
  // What the person reported is still theirs and still printed -- as a fact to verify, never with an assumed currency.
  const happened=empty.sections.find(section=>section.heading==="What happened")!.lines.join(" ");
  assert.match(happened,/Ambulance bill: 220 as reported \(currency and amount to be verified from the receipts\)/);
  assert.equal(/S\$|SGD/.test(happened),false,"A reported bill is never given a default SGD currency");

  // The printed page itself, read back with the real PDF extractor.
  const bytes=await renderClaimPack(content);
  assert.equal(Buffer.from(bytes.slice(0,5)).toString("latin1"),"%PDF-","The output is a real PDF");
  const pages=await extractPdfPages(new Uint8Array(bytes));
  assert.ok(pages.length>=1);
  const printed=pages.map(page=>page.text).join(" ").replace(/\s+/g," ");
  assert.match(printed,/Claim summary/);
  assert.match(printed,/Tan Yi Chuen Desmond/);
  assert.equal(/S\$1,250/.test(printed),false,"No calculated amount reaches the printed page");
  assert.match(printed,/Preliminary claim assessment/);
  assert.match(printed,/Hospital discharge summary/);
  assert.equal(/Death Benefit/.test(printed),false);

  // A long condition must wrap rather than run off the page or be dropped.
  const long="A ".repeat(400)+"final clause";
  const wrapped=await renderClaimPack(claimPackContent({packet:{...packet,
    assessments:[{...packet.assessments[0],conditions:[long]}]},claimantName:"Tan Yi Chuen Desmond"}));
  const wrappedPages=await extractPdfPages(new Uint8Array(wrapped));
  assert.ok(wrappedPages.length>=2,"Long content continues onto another page instead of being cut off");
  assert.match(wrappedPages.map(page=>page.text).join(" ").replace(/\s+/g," "),/final clause/,"Nothing is silently dropped off the end");

  console.log("DearPolicy claim pack regressions passed (content, event-specific checklist and the printed PDF).");
}

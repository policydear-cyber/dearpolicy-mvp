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
     conditions:[],evidenceTerms:["ambulance"],productName:"Group Personal Accident"},
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

  assert.match(flat,/Simple Fracture \(wrist\) — S\$1,250/,"The benefit and its amount appear together");
  assert.match(flat,/page 14/,"A figure is only usable next to the page it came from");
  assert.match(flat,/A medical report confirming the fracture is required\./);
  assert.equal(/Death Benefit/.test(flat),false,"A benefit that does not apply must never reach the insurer's desk");
  assert.match(flat,/the final hospital bill/,"What is still missing is stated, not hidden");
  assert.match(content.footer,/not an offer, an admission of liability, or a decision by any insurer/);
  assert.match(flat,/ESTIMATED claim amount/,"The sheet an insurer reads must call the figure what it is");

  // Documents follow the event, not a fixed list.
  const attachments=documentsToAttach(facts);
  for(const expected of ["Hospital discharge summary","Operation report","Ambulance invoice","Police or accident report, if one was made"])
    assert.ok(attachments.some(item=>item.includes(expected.split(",")[0])),"Missing from the checklist: "+expected);
  assert.equal(attachments.some(item=>/death certificate/i.test(item)),false,"Nobody died; asking for a death certificate would be cruel and wrong");
  const bereaved=documentsToAttach({...EMPTY_CLAIM_FACTS,death:true,deathDate:"2026-09-01",eventType:"death"});
  assert.ok(bereaved.some(item=>/Death certificate/.test(item)));
  assert.equal(bereaved.some(item=>/Operation report/.test(item)),false,"Only what this event actually needs is asked for");
  assert.equal(new Set(attachments).size,attachments.length,"The same document is never asked for twice");

  // An unassessed claim states that plainly instead of printing an empty sheet.
  const empty=claimPackContent({packet:{...packet,assessments:[]},claimantName:"Tan Yi Chuen Desmond"});
  const claimed=empty.sections.find(section=>section.heading==="Benefits being claimed")!;
  assert.match(claimed.lines.join(" "),/No benefit could be calculated yet/);
  assert.equal(/S\$/.test(claimed.lines.join(" ")),false,"With nothing assessed, no claimable figure may appear");
  // What the person reported is still theirs and still printed.
  assert.match(empty.sections.find(section=>section.heading==="What happened")!.lines.join(" "),/Ambulance bill: S\$220\.00/);

  // The printed page itself, read back with the real PDF extractor.
  const bytes=await renderClaimPack(content);
  assert.equal(Buffer.from(bytes.slice(0,5)).toString("latin1"),"%PDF-","The output is a real PDF");
  const pages=await extractPdfPages(new Uint8Array(bytes));
  assert.ok(pages.length>=1);
  const printed=pages.map(page=>page.text).join(" ").replace(/\s+/g," ");
  assert.match(printed,/Claim summary/);
  assert.match(printed,/Tan Yi Chuen Desmond/);
  assert.match(printed,/S\$1,250/,"The calculated amount survives into the printed page");
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

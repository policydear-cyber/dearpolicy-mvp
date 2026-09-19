import { assessClaim,nextClaimQuestion } from "@/lib/claims/rules";
import type { OwnedCoverage } from "@/lib/coverage/facts";
import { EMPTY_CLAIM_FACTS, type ClaimFacts } from "@/lib/claims/types";
import { runClaimRegressions } from "./claim-regressions";
import { runClaimWorkflowRegressions } from "./claim-workflow-regressions";
import { runDeathEvidenceRegressions } from "./death-evidence-regressions";
import { runSystemRegressions } from "./system-regressions";
import { runClaimAnswerEval } from "./claim-answer-eval";
import { runCoverConditionsStress } from "./cover-conditions-stress";
import { runClaimArithmeticStress } from "./claim-arithmetic-stress";
import { runBenefitFormulaStress } from "./benefit-formula-stress";
import { runScaleLimitStress } from "./scale-limit-stress";
import { runRealHouseholdReplay } from "./real-household-replay";
import { runClaimPackRegressions } from "./claim-pack-regressions";

const baseCoverage=(overrides:Partial<OwnedCoverage>):OwnedCoverage=>({id:"x",policyId:"p",familyMemberId:"m",category:"Death",amount:null,currency:"SGD",productName:null,sourcePage:1,evidenceText:"test",insurer:"Singlife",policyName:"MINDEF & MHA Group Insurance",policyNumber:"3037850",groupPolicyNumber:"G007500",documentRole:"certificate",effectiveDate:"2022-10-06",renewalOrExpiryDate:null,...overrides});
const coverages:OwnedCoverage[]=[
  baseCoverage({id:"gtl",category:"Death",amount:1_000_000,productName:"Group Term Life"}),
  baseCoverage({id:"gpa",category:"Personal Accident",amount:600_000,productName:"Group Personal Accident"}),
  baseCoverage({id:"lc",category:"Critical Illness",amount:350_000,productName:"Living Care"}),
  baseCoverage({id:"lcp",category:"Early Critical Illness",amount:300_000,productName:"Living Care Plus"}),
];
const accident:ClaimFacts={...EMPTY_CLAIM_FACTS,eventType:"accident",eventDate:"2026-09-14",accidentType:"motorcycle accident",injured:true,injuries:["fracture"],fractureBodyPart:"wrist",diagnosis:null,diagnosisDate:null,hospitalised:true,hospitalNights:2,ambulanceUsed:true,ambulanceBill:220,hospitalBill:null,outOfPocket:null,surgery:null,permanentImpairment:false,competitiveRacing:false,medicalReportAvailable:null,uncertainFacts:[]};
if(nextClaimQuestion(accident,coverages)!==null)throw new Error("Accident fixture should be ready for assessment");
const a=assessClaim(accident,coverages);if(a.find(x=>x.id==="gpa-fracture")?.amountText!=="S$1,250")throw new Error("Wrist fracture calculation failed");if(a.find(x=>x.id==="gpa-ambulance")?.amountText!=="S$220.00")throw new Error("Ambulance reimbursement calculation failed");if(a.find(x=>x.id==="gtl-hospital-cash")?.status!=="not_applicable")throw new Error("2-night hospital cash should be not applicable");
const cancer:ClaimFacts={...accident,eventType:"diagnosis",eventDate:null,accidentType:null,injured:null,injuries:[],fractureBodyPart:null,diagnosis:"stage 3 colon cancer",diagnosisDate:"2026-09-01",hospitalised:false,hospitalNights:null,ambulanceUsed:null,ambulanceBill:null,permanentImpairment:null,competitiveRacing:null};
const c=assessClaim(cancer,coverages);if(c.find(x=>x.id==="living-care")?.amountText!=="S$350,000")throw new Error("Living Care amount failed");
console.log("DearPolicy claim-rule smoke tests passed.");
runSystemRegressions();
runClaimAnswerEval();
runCoverConditionsStress();
runClaimArithmeticStress();
runBenefitFormulaStress();
runScaleLimitStress();
runRealHouseholdReplay({quiet:true});
console.log("DearPolicy real-household replay passed (one real scheme, 125 stored rules, nine questions).");
runClaimRegressions().then(runDeathEvidenceRegressions).then(runClaimWorkflowRegressions).then(runClaimPackRegressions).catch(error => { console.error(error); process.exitCode=1; });

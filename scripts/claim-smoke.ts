import { assessClaim,nextClaimQuestion } from "@/lib/claims/rules";
import type { OwnedCoverage } from "@/lib/coverage/facts";
import { EMPTY_CLAIM_FACTS, type ClaimFacts } from "@/lib/claims/types";
import { claimTable, personCover, printed, tableRow } from "./fixtures/claim-table";
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
import { runMonetaryGateRegressions } from "./monetary-gate-regressions";
import { runHospitalCashCalculatorRegressions } from "./hospital-cash-calculator-regressions";
import { runLedgerHospitalCashRegressions } from "./ledger-hospital-cash-regressions";
import { runAccidentalDeathCalculatorRegressions, runDeathBenefitCalculatorRegressions } from "./death-benefit-calculator-regressions";
import { runDeathBenefitContextualRegressions } from "./death-benefit-contextual-regressions";

const baseCoverage=(overrides:Partial<OwnedCoverage>):OwnedCoverage=>({id:"x",policyId:"p",familyMemberId:"m",category:"Death",amount:null,currency:"SGD",productName:null,sourcePage:1,evidenceText:"test",insurer:"Singlife",policyName:"MINDEF & MHA Group Insurance",policyNumber:"3037850",groupPolicyNumber:"G007500",documentRole:"certificate",effectiveDate:"2022-10-06",renewalOrExpiryDate:null, currencyVerified: true,...overrides});
const coverages:OwnedCoverage[]=[
  baseCoverage({id:"gtl",category:"Death",amount:1_000_000,productName:"Group Term Life"}),
  baseCoverage({id:"gpa",category:"Personal Accident",amount:600_000,productName:"Group Personal Accident"}),
  baseCoverage({id:"lc",category:"Critical Illness",amount:350_000,productName:"Living Care"}),
  baseCoverage({id:"lcp",category:"Early Critical Illness",amount:300_000,productName:"Living Care Plus"}),
];
const accident:ClaimFacts={...EMPTY_CLAIM_FACTS,eventType:"accident",eventDate:"2026-09-14",accidentType:"motorcycle accident",injured:true,injuries:["fracture"],fractureBodyPart:"wrist",diagnosis:null,diagnosisDate:null,hospitalised:true,hospitalNights:2,ambulanceUsed:true,ambulanceBill:220,hospitalBill:null,outOfPocket:null,surgery:null,permanentImpairment:false,competitiveRacing:false,medicalReportAvailable:null,uncertainFacts:[]};
if(nextClaimQuestion(accident,coverages)!==null)throw new Error("Accident fixture should be ready for assessment");
// Amounts come from the person's own benefit table, never from figures in code (G007500 removal, PR B): the same wrist,
// ambulance and hospital-cash cases, now with the rows a document prints.
const table=claimTable([
  tableRow("gpa","Group Personal Accident","Wrist",printed(1250,"lump_sum"),{section:"Simple Fracture"}),
  tableRow("gpa","Group Personal Accident","Ambulance Cost",printed(500,"up_to")),
  tableRow("gtl","Group Term Life","Daily Hospital Cash Benefit",printed(30,"per_day"),{fromDay:11,maxDays:30}),
],[personCover("gpa","Group Personal Accident"),personCover("gtl","Group Term Life")]);
if(assessClaim(accident,coverages).some(x=>x.amountText!=null||x.calculatedAmount!=null))throw new Error("Without a benefit table no accident amount may come from code");
const a=assessClaim(accident,coverages,[],[],null,[],[],undefined,undefined,undefined,table);
if(a.find(x=>x.id.startsWith("table-fracture"))?.amountText!=="S$1,250")throw new Error("Wrist fracture row failed");
const amb=a.find(x=>x.id.startsWith("table-ambulance"));if(!amb||amb.amountText!=null||!/up to S\$500/i.test(amb.reason))throw new Error("Ambulance row should print its limit without estimating the bill");
if(a.find(x=>x.id.startsWith("table-hospital-cash"))?.status!=="not_applicable")throw new Error("2-night hospital cash should be not applicable");
const cancer:ClaimFacts={...accident,eventType:"diagnosis",eventDate:null,accidentType:null,injured:null,injuries:[],fractureBodyPart:null,diagnosis:"stage 3 colon cancer",diagnosisDate:"2026-09-01",hospitalised:false,hospitalNights:null,ambulanceUsed:null,ambulanceBill:null,permanentImpairment:null,competitiveRacing:null};
// A critical illness pays only once the diagnosis is checked against the policy's own definition (ci-rules); the table
// row shows what the document prints, with no amount.
const ciTable=claimTable([tableRow("lc","Living Care","Critical Illness Benefit",printed(350000,"lump_sum"))],[personCover("lc","Living Care")]);
const c=assessClaim(cancer,coverages,[],[],null,[],[],undefined,undefined,undefined,ciTable);const ci=c.find(x=>x.id.startsWith("table-critical-illness"));
if(!ci||ci.amountText!=null||!/S\$350,000/.test(ci.reason))throw new Error("Critical illness row should show its printed figure without an amount");
if(assessClaim(cancer,coverages).some(x=>x.amountText!=null))throw new Error("Without a benefit table no critical-illness amount may come from code");
console.log("DearPolicy claim-rule smoke tests passed.");
runMonetaryGateRegressions();
runHospitalCashCalculatorRegressions();
runLedgerHospitalCashRegressions();
runDeathBenefitCalculatorRegressions();
runAccidentalDeathCalculatorRegressions();
runSystemRegressions();
runClaimAnswerEval();
runCoverConditionsStress();
runClaimArithmeticStress();
runBenefitFormulaStress();
runScaleLimitStress();
runRealHouseholdReplay({quiet:true});
console.log("DearPolicy real-household replay passed (one real scheme, 125 stored rules, nine questions).");
runDeathBenefitContextualRegressions().then(runClaimRegressions).then(runDeathEvidenceRegressions).then(runClaimWorkflowRegressions).then(runClaimPackRegressions).catch(error => { console.error(error); process.exitCode=1; });

import assert from "node:assert/strict";
import { caseFor, rowConsistent } from "../lib/rag2/calc/case-terms";
const rows = [
  {id:"thigh", label:"Leg - thigh bone (femur)"},
  {id:"shin", label:"Leg - below the knee (tibia or fibula)"},
  {id:"wrist", label:"Wrist"},
];
let checks = 0;
const check = (name: string, fn: () => void) => { fn(); checks++; console.log("PASS", name); };
for (const ordered of [rows, [...rows].reverse()]) {
  for (const [words, id] of [["shin bone","shin"],["thigh bone","thigh"],["wrist","wrist"],["leg, specifically tibia","shin"],["closed tibia fracture, no surgery","shin"]]) {
    check("positive "+words, () => { const c=caseFor(ordered, words); assert.equal(c.kind,"row"); if(c.kind==="row") assert.equal(c.row.id,id); });
  }
  check("generic leg remains ambiguous", () => { const c=caseFor(ordered,"leg"); assert.equal(c.kind,"ambiguous"); if(c.kind==="ambiguous") assert.deepEqual(c.rows.map(r=>r.id).sort(),["shin","thigh"]); });
  for(const words of ["shin and thigh","thigh and shin","tibia or femur","wrist and shin","not the thigh, the shin","It was his shin, not his wrist","not the thigh","no wrist fracture"]) {
    check("no arbitrary row: "+words, () => { const c=caseFor(ordered,words); assert.equal(c.kind,"ambiguous"); if(c.kind==="ambiguous") assert.equal(c.conflicting,true); for(const r of ordered) assert.equal(rowConsistent(ordered,r,[words]).ok,false); });
  }
  check("unlisted part cannot be ignored", () => { assert.equal(caseFor(ordered,"shin and rib").kind,"unlisted"); });
}
check("single generic region covers its specific part", () => { assert.equal(caseFor([{id:"leg",label:"Leg"}],"shin").kind,"row"); });
check("same compensation row may cover two named parts", () => { assert.equal(caseFor([{id:"shared",label:"Jaw, Pelvis, Leg or Knee"}],"jaw and shin").kind,"row"); });
check("ordinary ambiguity permits a consistent selection", () => { assert.equal(rowConsistent(rows,rows[0],["leg"]).ok,true); });
check("affirmative correction replaces stale words upstream", () => { assert.equal(rowConsistent(rows,rows[0],["thigh bone"]).ok,true); assert.equal(rowConsistent(rows,rows[1],["thigh bone"]).ok,false); });
console.log(checks+" checks passed");

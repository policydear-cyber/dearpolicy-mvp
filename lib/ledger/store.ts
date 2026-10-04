/**
 * The Coverage Ledger — storage, seeding and loading.
 *
 * Seeding turns what DearPolicy has already read into ledger rows:
 *   - a schedule or certificate line ("Group Term Life · S$1,000,000") becomes
 *     the standard rows for that kind of plan (death, TPD, terminal illness),
 *     each marked as a proposal that assumes the standard rule;
 *   - a benefit-table row read from wording becomes a row for the event its
 *     name describes, with the formula that was read.
 * Seeding is additive and idempotent: a row is keyed by what it came from, so
 * re-seeding after a new upload adds only what is new and never touches a
 * row the person has confirmed or corrected.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pool,query } from "@/lib/db/client";
import { activePredicate } from "@/lib/lifecycle/scopes";
import { statedCurrencyCode } from "@/lib/format/currency";
import type { ClaimPerson } from "@/lib/claims/person";
import { loadPolicyInventory,type PolicyContract } from "@/lib/policies/inventory";
import { coverageForBenefit,loadBenefitCatalog,preferStatedRules,selectTierRows,type CatalogBenefit } from "@/lib/policies/benefit-catalog";
import { EVENTS,PRODUCT_DEFAULTS,causeForBenefit,eventForBenefitName,type EventType,type PaysKind } from "@/lib/ledger/events";

export type LedgerRow={
  id:string;familyMemberId:string;policyId:string|null;planName:string;insurer:string|null;
  eventType:EventType;detail:string|null;cause:"accident"|"illness"|null;paysKind:PaysKind;amount:number|null;currency:string;sumBasis:number|null;
  minimumFact:string|null;minimumValue:number|null;
  offsetDays:number|null;maximumDays:number|null;conditions:string[];note:string|null;
  sourcePage:number|null;quote:string|null;origin:"schedule"|"wording"|"person";inferred:boolean;
  status:"proposed"|"confirmed"|"rejected";updatedAt:string;
};
type Row={id:string;family_member_id:string;policy_id:string|null;plan_name:string;insurer:string|null;event_type:string;detail:string|null;cause:string|null;
  minimum_fact:string|null;minimum_value:string|number|null;pays_kind:string;amount:string|number|null;currency:string;sum_basis:string|number|null;offset_days:number|null;maximum_days:number|null;
  conditions:string[]|null;note:string|null;source_page:number|null;quote:string|null;origin:string;inferred:boolean;status:string;updated_at:string};
type LedgerGlobals=typeof globalThis&{__dearpolicyLedgerSchema?:Promise<void>;__dearpolicyLedgerSchemaReady?:boolean};

export async function ensureLedgerSchema(){
  const state=globalThis as LedgerGlobals;
  if(state.__dearpolicyLedgerSchemaReady)return;
  // Cheap check first, so the migration runs only when it actually has work
  // to do. This checks for the newest column the migration adds, not just
  // the table: a table created before a later ALTER TABLE was appended to
  // sql/coverage-ledger.sql must still pick that column up on an existing
  // database, or every ledger query fails with "column does not exist".
  const present=await query<{ok:string|null}>(
    "SELECT column_name AS ok FROM information_schema.columns WHERE table_name='coverage_rules' AND column_name='minimum_fact'"
  ).then(r=>!!r.rows[0]?.ok).catch(()=>false);
  if(present){state.__dearpolicyLedgerSchemaReady=true;return;}
  state.__dearpolicyLedgerSchema??=(async()=>{
    const sql=await readFile(path.join(process.cwd(),"sql/coverage-ledger.sql"),"utf8");
    const client=await pool.connect();
    try{
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(73499203)");
      await client.query(sql);
      await client.query("COMMIT");
    }catch(error){await client.query("ROLLBACK");throw error;}
    finally{client.release();}
  })().catch(error=>{delete state.__dearpolicyLedgerSchema;throw error;});
  try{await state.__dearpolicyLedgerSchema;state.__dearpolicyLedgerSchemaReady=true;}finally{delete state.__dearpolicyLedgerSchema;}
}
const num=(v:string|number|null)=>v==null?null:Number(v);
function toRow(r:Row):LedgerRow{
  return {id:r.id,familyMemberId:r.family_member_id,policyId:r.policy_id,planName:r.plan_name,insurer:r.insurer,
    eventType:(r.event_type in EVENTS?r.event_type:"other") as EventType,detail:r.detail,cause:(r.cause==="accident"||r.cause==="illness")?r.cause:null,paysKind:r.pays_kind as PaysKind,
    amount:num(r.amount),currency:r.currency,sumBasis:num(r.sum_basis),minimumFact:r.minimum_fact,minimumValue:num(r.minimum_value),offsetDays:r.offset_days,maximumDays:r.maximum_days,
    conditions:r.conditions??[],note:r.note,sourcePage:r.source_page,quote:r.quote,origin:r.origin as LedgerRow["origin"],
    inferred:r.inferred,status:r.status as LedgerRow["status"],updatedAt:r.updated_at};
}
const SELECT="SELECT id,family_member_id,policy_id,plan_name,insurer,event_type,detail,cause,minimum_fact,minimum_value::text,pays_kind,amount::text,currency,sum_basis::text,offset_days,maximum_days,conditions,note,source_page,quote,origin,inferred,status,updated_at::text FROM coverage_rules";
// A row whose policy_id points at a policy that is no longer active must
// stop appearing on the Coverage Ledger and out of chat answers the moment
// that policy is deleted (Checkpoint 7's "policy totals are invalidated
// immediately" requirement) -- this table has no lifecycle_state column of
// its own (it is derived data keyed by policy_id), so the guard has to be a
// subquery back to policies rather than an activePredicate() on this table
// directly. A NULL policy_id (a standard-rule default not tied to any one
// document, or a manually-added row) is never filtered out by this.
const ACTIVE_POLICY_GUARD="(policy_id IS NULL OR EXISTS(SELECT 1 FROM policies p WHERE p.id=coverage_rules.policy_id AND p.account_id=coverage_rules.account_id AND p.superseded_at IS NULL AND "+activePredicate("p")+"))";

export async function loadLedger(accountId:string,memberIds?:string[]):Promise<LedgerRow[]>{
  await ensureLedgerSchema();
  const r=memberIds
    ?await query<Row>(SELECT+" WHERE account_id=$1 AND family_member_id=ANY($2::uuid[]) AND status<>'rejected' AND "+ACTIVE_POLICY_GUARD+" ORDER BY plan_name,event_type,detail",[accountId,memberIds])
    :await query<Row>(SELECT+" WHERE account_id=$1 AND "+ACTIVE_POLICY_GUARD+" ORDER BY family_member_id,plan_name,event_type,detail",[accountId]);
  return r.rows.map(toRow);
}
export async function loadLedgerRow(accountId:string,id:string){
  await ensureLedgerSchema();
  const r=await query<Row>(SELECT+" WHERE account_id=$1 AND id=$2 AND "+ACTIVE_POLICY_GUARD,[accountId,id]);
  return r.rows[0]?toRow(r.rows[0]):null;
}
export async function updateLedgerRow(accountId:string,id:string,patch:Partial<Pick<LedgerRow,"status"|"amount"|"paysKind"|"eventType"|"sumBasis"|"detail"|"planName">>){
  await ensureLedgerSchema();
  const sets:string[]=[];const values:unknown[]=[accountId,id];
  const set=(column:string,value:unknown)=>{values.push(value);sets.push(column+"=$"+values.length);};
  if(patch.status!==undefined)set("status",patch.status);
  if(patch.amount!==undefined)set("amount",patch.amount);
  if(patch.paysKind!==undefined)set("pays_kind",patch.paysKind);
  if(patch.eventType!==undefined)set("event_type",patch.eventType);
  if(patch.sumBasis!==undefined)set("sum_basis",patch.sumBasis);
  if(patch.detail!==undefined)set("detail",patch.detail);
  if(patch.planName!==undefined)set("plan_name",patch.planName);
  if(!sets.length)return loadLedgerRow(accountId,id);
  await query("UPDATE coverage_rules SET "+sets.join(",")+",updated_at=now() WHERE account_id=$1 AND id=$2",values);
  return loadLedgerRow(accountId,id);
}
/** coverage_rules.currency is NOT NULL (DEFAULT 'SGD') in the live schema.
 * A household row with no amount has no currency to state; the column still
 * needs a value, and it is never shown because there is no figure to label. */
const UNPRICED_ROW_CURRENCY="SGD";
export async function addLedgerRow(accountId:string,row:{familyMemberId:string;policyId:string|null;planName:string;eventType:EventType;paysKind:PaysKind;amount:number|null;currency?:string;detail?:string|null;note?:string|null}){
  await ensureLedgerSchema();
  const currency=statedCurrencyCode(row.currency);
  // A percentage is not money; every other amount must say what currency it is in.
  if(row.amount!=null&&row.paysKind!=="percent_of_sum"&&row.paysKind!=="stated"&&!currency)throw new Error("State the currency of this amount.");
  const r=await query<{id:string}>(
    "INSERT INTO coverage_rules(account_id,family_member_id,policy_id,plan_name,event_type,detail,pays_kind,amount,currency,note,origin,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'person','confirmed') RETURNING id",
    [accountId,row.familyMemberId,row.policyId,row.planName,row.eventType,row.detail??null,row.paysKind,row.amount,currency??UNPRICED_ROW_CURRENCY,row.note??null]);
  return loadLedgerRow(accountId,r.rows[0].id);
}

type Seed={familyMemberId:string;policyId:string|null;planName:string;insurer:string|null;eventType:EventType;detail:string|null;cause:"accident"|"illness"|null;paysKind:PaysKind;
  amount:number|null;currency:string;sumBasis:number|null;offsetDays:number|null;maximumDays:number|null;conditions:string[];note:string|null;
  sourcePage:number|null;quote:string|null;origin:"schedule"|"wording";inferred:boolean;status:"proposed"|"confirmed";seedKey:string};

function planLabel(contract:PolicyContract,productName:string|null,category?:string){
  const base=productName??contract.name;
  if(category&&category.toLowerCase()!==base.toLowerCase()&&!base.toLowerCase().includes(category.toLowerCase()))return base+" · "+category;
  return base;
}
function wordingSeeds(contract:PolicyContract,benefits:CatalogBenefit[]):Seed[]{
  const out:Seed[]=[];
  for(const benefit of benefits){
    const {event,detail}=eventForBenefitName(benefit.benefitName);
    const coverage=coverageForBenefit(contract,benefit);
    // A rule whose currency is written nowhere is not seeded: the ledger
    // cannot store an amount without labelling it, and SGD is never assumed.
    const currency=statedCurrencyCode(benefit.currency??coverage?.currency);
    if(!currency)continue;
    const kind:PaysKind=benefit.formulaKind==="sum_insured"?"percent_of_sum":benefit.formulaKind==="fixed"?"lump_sum":benefit.formulaKind==="expense_cap"?"reimbursement_cap":benefit.formulaKind==="daily"?"per_day":"stated";
    out.push({familyMemberId:contract.ownerId,policyId:benefit.policyId,planName:planLabel(contract,benefit.productName),insurer:contract.insurer,
      eventType:event,detail:detail??(event==="other"?benefit.benefitName:null),cause:causeForBenefit(benefit.benefitName,benefit.requires??[]),paysKind:kind,
      amount:kind==="stated"?null:benefit.formulaValue,currency,sumBasis:kind==="percent_of_sum"?(coverage?.amount??null):null,
      offsetDays:benefit.offsetDays,maximumDays:benefit.maximumDays,
      conditions:[...benefit.conditions,...benefit.requirements.map(r=>r.why)].filter(Boolean).slice(0,6),
      note:benefit.benefitName,sourcePage:benefit.sourcePage,quote:benefit.quote,origin:"wording",inferred:!!benefit.basisInferred,
      // The same trust rule the benefit catalogue itself uses: a rule needs a
      // person's confirmation only when its basis was inferred (read from a
      // heading, not the row) and nobody has reviewed it since -- not simply
      // whichever rule happened to be read first. Requiring a literal
      // reviewed_at here regardless of that, as this used to, disagreed with
      // the catalogue's own answer for the identical benefit and withheld a
      // figure the catalogue already trusts.
      status:benefit.needsConfirmation?"proposed":"confirmed",seedKey:"benefit:"+benefit.id+"|member:"+contract.ownerId});
  }
  return out;
}
function scheduleSeeds(contract:PolicyContract,eventsFromWording:Set<EventType>):Seed[]{
  const out:Seed[]=[];
  for(const coverage of contract.coverages){
    if(coverage.amount==null||!(coverage.amount>0))continue;
    const name=(coverage.category+" "+(coverage.productName??"")+" "+contract.name).trim();
    const kind=PRODUCT_DEFAULTS.find(d=>d.pattern.test(name)&&!(d.exclude&&d.exclude.test(name)));
    if(!kind)continue;
    const currency=statedCurrencyCode(coverage.currency);
    if(!currency)continue; // never assume SGD for a schedule line
    for(const ev of kind.events){
      if(eventsFromWording.has(ev.event))continue; // the wording already says what this pays
      out.push({familyMemberId:contract.ownerId,policyId:coverage.policyId,planName:planLabel(contract,coverage.productName,coverage.category),insurer:coverage.insurer??contract.insurer,
        eventType:ev.event,detail:null,cause:null,paysKind:ev.pays,amount:ev.pays==="lump_sum"?coverage.amount:null,currency,
        sumBasis:coverage.amount,offsetDays:null,maximumDays:null,conditions:[],note:ev.note,
        sourcePage:coverage.sourcePage,quote:coverage.evidenceText,origin:"schedule",inferred:false,status:"proposed",
        seedKey:"coverage:"+coverage.id+":"+ev.event+"|member:"+contract.ownerId});
    }
  }
  return out;
}
/** Adds ledger rows for everything read so far that is not in the ledger yet. */
export async function seedLedger(accountId:string,people?:ClaimPerson[]):Promise<{added:number}>{
  await ensureLedgerSchema();
  const family=people??(await query<ClaimPerson>(`SELECT id,display_name,preferred_name,relationship FROM family_members WHERE account_id=$1 AND ${activePredicate()} ORDER BY created_at`,[accountId])).rows;
  if(!family.length)return {added:0};
  // Round 9: a re-read rebuilds a document's benefit and cover rows (new ids),
  // so a row seeded from a row that no longer exists is stale: it is removed
  // (unless a person changed or rejected it) before seeding, never left to
  // stand beside the row seeded from the new read.
  await query(
    `DELETE FROM coverage_rules c WHERE c.account_id=$1 AND c.origin<>'person' AND c.status<>'rejected' AND c.updated_at=c.created_at
       AND ((c.seed_key LIKE 'benefit:%' AND split_part(split_part(c.seed_key,'|',1),':',2) NOT IN (SELECT id::text FROM policy_benefits WHERE account_id=$1))
         OR (c.seed_key LIKE 'coverage:%' AND split_part(split_part(c.seed_key,'|',1),':',2) NOT IN (SELECT id::text FROM policy_coverages WHERE account_id=$1)))`,
    [accountId]).catch(()=>undefined);
  const inventory=await loadPolicyInventory(accountId,family);
  const contracts=inventory.contracts;
  const documentIds=[...new Set(contracts.flatMap(c=>[...c.documents,...c.references].map(d=>d.id)))];
  const catalog=documentIds.length?await loadBenefitCatalog(accountId,documentIds).catch(()=>[] as CatalogBenefit[]):[];
  // Rows the model already read from these documents outrank both the table
  // parser and the standard-rule defaults for the same event.
  const existing=await query<{policy_id:string|null;event_type:string;amount:string|null;pays_kind:string}>(
    "SELECT policy_id,event_type,amount::text,pays_kind FROM coverage_rules WHERE account_id=$1 AND origin='wording' AND status<>'rejected'",[accountId]);
  const tiers=new Map((await query<{policy_id:string;family_member_id:string;tier:string|null}>(
    "SELECT policy_id,family_member_id,to_jsonb(pm)->>'benefit_tier' AS tier FROM policy_members pm WHERE account_id=$1",[accountId]).catch(()=>({rows:[]}))).rows
    .map(r=>[r.policy_id+"|"+r.family_member_id,r.tier] as const));
  const seeds:Seed[]=[];
  for(const contract of contracts){
    const mine=new Set([...contract.documents,...contract.references].map(d=>d.id));
    const known=new Set<EventType>(existing.rows.filter(r=>r.policy_id&&mine.has(r.policy_id)&&r.pays_kind!=="stated"&&r.amount!=null).map(r=>r.event_type as EventType));
    // A multi-column table's row applies only to the person class or plan
    // tier of its column: a child gets the Child column, a Plan B employee
    // the Plan B column (policy_members.benefit_tier).
    const wording=wordingSeeds(contract,preferStatedRules(selectTierRows(catalog.filter(b=>mine.has(b.policyId)),
      policyId=>tiers.get(policyId+"|"+contract.ownerId)))).filter(w=>!known.has(w.eventType));
    for(const w of wording)if(w.paysKind!=="stated")known.add(w.eventType);
    seeds.push(...wording,...scheduleSeeds(contract,known));
  }
  // A rule read from the wording ("100% of the Sum Insured") and the sum on
  // the certificate live in different documents of the same contract. Join
  // them here, once, so the row carries its own figure.
  const unbased=await query<{id:string;policy_id:string|null;plan_name:string;family_member_id:string}>(
    "SELECT id,policy_id,plan_name,family_member_id FROM coverage_rules WHERE account_id=$1 AND pays_kind='percent_of_sum' AND sum_basis IS NULL AND policy_id IS NOT NULL",[accountId]);
  for(const row of unbased.rows){
    const contract=contracts.find(c=>c.ownerId===row.family_member_id&&[...c.documents,...c.references].some(d=>d.id===row.policy_id));
    if(!contract)continue;
    const priced=contract.coverages.filter(c=>c.amount!=null&&c.amount>0);
    const words=row.plan_name.toLowerCase().split(/[^a-z0-9]+/).filter(w=>w.length>3);
    const match=priced.find(c=>words.some(w=>(c.productName??"").toLowerCase().includes(w)||c.category.toLowerCase().includes(w)))??(priced.length===1?priced[0]:null);
    // A join made here, not a person's edit: updated_at is left alone, so a re-read still replaces the row.
    if(match?.amount!=null)await query("UPDATE coverage_rules SET sum_basis=$3 WHERE account_id=$1 AND id=$2",[accountId,row.id,match.amount]);
  }
  let added=0;
  for(const s of seeds){
    // Two insured people under one certificate ("Insured persons: Mei Ling;
    // Wei Jie") read the same row: each gets their own ledger row. A row
    // seeded under the older person-less key is that person's already.
    const legacy=s.seedKey.replace(/\|member:[^|]+$/,"");
    if(legacy!==s.seedKey&&(await query("SELECT 1 FROM coverage_rules WHERE account_id=$1 AND family_member_id=$2 AND seed_key=$3 LIMIT 1",[accountId,s.familyMemberId,legacy])).rows.length)continue;
    const r=await query<{id:string}>(
      `INSERT INTO coverage_rules(account_id,family_member_id,policy_id,plan_name,insurer,event_type,detail,cause,pays_kind,amount,currency,sum_basis,offset_days,maximum_days,conditions,note,source_page,quote,origin,inferred,status,seed_key)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::text[],$16,$17,$18,$19,$20,$21,$22)
       ON CONFLICT (account_id,seed_key) WHERE seed_key IS NOT NULL DO NOTHING RETURNING id`,
      [accountId,s.familyMemberId,s.policyId,s.planName,s.insurer,s.eventType,s.detail,s.cause,s.paysKind,s.amount,s.currency,s.sumBasis,s.offsetDays,s.maximumDays,s.conditions,s.note,s.sourcePage,s.quote,s.origin,s.inferred,s.status,s.seedKey]);
    added+=r.rows.length;
  }
  return {added};
}
/** Loads the ledger for these people, seeding it first if it is empty. */
export async function ledgerFor(accountId:string,people:ClaimPerson[]):Promise<LedgerRow[]>{
  const ids=people.map(p=>p.id);
  let rows=await loadLedger(accountId,ids);
  if(!rows.length){
    const all=await query<{n:number}>("SELECT count(*)::int AS n FROM coverage_rules WHERE account_id=$1",[accountId]);
    if(Number(all.rows[0]?.n??0)===0){await seedLedger(accountId);rows=await loadLedger(accountId,ids);}
  }
  return rows;
}

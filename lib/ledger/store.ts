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
import { formatMoney,statedCurrencyCode } from "@/lib/format/currency";
import type { ClaimPerson } from "@/lib/claims/person";
import { loadPolicyInventory,type PolicyContract } from "@/lib/policies/inventory";
import { coverageForBenefit,loadBenefitCatalog,preferStatedRules,selectTierRows,type CatalogBenefit } from "@/lib/policies/benefit-catalog";
import { amountAlternatives,type AmountAlternatives } from "@/lib/policies/amount-alternatives";
import { EVENTS,PRODUCT_DEFAULTS,causeForBenefit,eventForBenefitName,rowFiguresDependOnPlan,type EventType,type PaysKind } from "@/lib/ledger/events";

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
  // The person (and document, when one is named) must be this household's: the foreign keys alone accept any household's ids.
  const r=await query<{id:string}>(
    `INSERT INTO coverage_rules(account_id,family_member_id,policy_id,plan_name,event_type,detail,pays_kind,amount,currency,note,origin,status)
     SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'person','confirmed'
      WHERE EXISTS (SELECT 1 FROM family_members f WHERE f.id=$2::uuid AND f.account_id=$1::uuid AND ${activePredicate("f")})
        AND ($3::uuid IS NULL OR EXISTS (SELECT 1 FROM policies p WHERE p.id=$3::uuid AND p.account_id=$1::uuid AND ${activePredicate("p")}))
     RETURNING id`,
    [accountId,row.familyMemberId,row.policyId,row.planName,row.eventType,row.detail??null,row.paysKind,row.amount,currency??UNPRICED_ROW_CURRENCY,row.note??null]);
  if(!r.rows[0])return null;
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
const PLAN_COLUMNS_NOTE="The document prints a different figure for each plan, and which plan is yours is not shown, so no figure is taken from it.";
function wordingSeeds(contract:PolicyContract,benefits:CatalogBenefit[]):Seed[]{
  const out:Seed[]=[];
  // A row read once per plan column whose plan was not narrowed to this person's (selectTierRows keeps every column when
  // their plan is unknown) is one benefit with several figures: it is seeded once, without a figure.
  const rowKey=(b:CatalogBenefit)=>b.policyId+"|"+b.benefitName.toLowerCase()+"|"+(b.sourcePage??"");
  const columns=new Map<string,Set<string>>();
  for(const b of benefits)if(b.tier)columns.set(rowKey(b),new Set([...(columns.get(rowKey(b))??[]),b.tier]));
  const seen=new Set<string>();
  for(const benefit of benefits){
    // "Not covered" is a schedule term, not something the plan pays.
    if(benefit.rowKind==="not_covered")continue;
    const perPlan=(columns.get(rowKey(benefit))?.size??0)>1||(!benefit.tier&&rowFiguresDependOnPlan(benefit.quote));
    if(perPlan){if(seen.has(rowKey(benefit)))continue;seen.add(rowKey(benefit));}
    const {event,detail}=eventForBenefitName(benefit.benefitName);
    const coverage=coverageForBenefit(contract,benefit);
    // A rule whose currency is written nowhere is not seeded: the ledger
    // cannot store an amount without labelling it, and SGD is never assumed.
    const currency=statedCurrencyCode(benefit.currency??coverage?.currency);
    if(!currency)continue;
    const kind:PaysKind=perPlan?"stated":benefit.formulaKind==="sum_insured"?"percent_of_sum":benefit.formulaKind==="fixed"?"lump_sum":benefit.formulaKind==="expense_cap"?"reimbursement_cap":benefit.formulaKind==="daily"?"per_day":"stated";
    out.push({familyMemberId:contract.ownerId,policyId:benefit.policyId,planName:planLabel(contract,benefit.productName),insurer:contract.insurer,
      eventType:event,detail:detail??(event==="other"?benefit.benefitName:null),cause:causeForBenefit(benefit.benefitName,benefit.requires??[]),paysKind:kind,
      amount:kind==="stated"?null:benefit.formulaValue,currency,sumBasis:kind==="percent_of_sum"?(coverage?.amount??null):null,
      offsetDays:benefit.offsetDays,maximumDays:benefit.maximumDays,
      conditions:[...(perPlan?[PLAN_COLUMNS_NOTE]:[]),...benefit.conditions,...benefit.requirements.map(r=>r.why)].filter(Boolean).slice(0,6),
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
const ACCIDENT_EVENTS=new Set(["accidental_death","fracture","dismemberment","accidental_disablement","accident_medical_expense"]);
/** The cover a ledger row's "percentage of the sum insured" applies to, or null when that cannot be told. */
export function coverageForLedgerRow(contract:PolicyContract,row:{event_type:string;detail:string|null;cause:string|null;note:string|null}){
  const label=EVENTS[row.event_type as EventType]?.label??row.event_type;
  const name=[row.note,row.detail,label].filter(Boolean).join(" · ");
  const accident=row.cause==="accident"||ACCIDENT_EVENTS.has(row.event_type);
  const stub:CatalogBenefit={id:"ledger-row",policyId:"",productName:null,benefitName:name,traits:[],requires:accident?["accident"]:[],
    formulaKind:"sum_insured",formulaValue:null,currency:null,factKey:null,offsetDays:null,maximumDays:null,sourcePage:null,quote:"",
    conditions:[],requirements:[],needsReview:false};
  return coverageForBenefit({...contract,coverages:contract.coverages.filter(c=>c.amount!=null&&c.amount>0)},stub);
}
/** Rows changed within a minute of this many other machine-made rows were changed by a machine, not a person. */
const MACHINE_BATCH=5;
const WRONG_COVER_NOTE="This may be worked out from the wrong cover";
/** The note for a changed row whose sum insured is another cover's, or null when it already says so. */
function wrongCoverNote(stored:number,basis:number|null,currency:string,conditions:string[]|null){
  if((conditions??[]).some(c=>c.startsWith(WRONG_COVER_NOTE)))return null;
  const money=(v:number)=>formatMoney(v,currency);
  return WRONG_COVER_NOTE+": "+money(stored)+" is the sum insured of another cover"+(basis!=null?"; the cover this pays under is "+money(basis):"")+". Check it before relying on it.";
}
async function refreshSeededRows(accountId:string,seeds:Seed[]){
  if(!seeds.length)return;
  const legacyOf=(s:Seed)=>s.seedKey.replace(/\|member:[^|]+$/,"");
  const bySeedKey=new Map<string,Seed>();
  for(const s of seeds){bySeedKey.set(s.seedKey,s);bySeedKey.set(legacyOf(s)+"#"+s.familyMemberId,s);}
  const held=(await query<{id:string;seed_key:string;family_member_id:string;event_type:string;detail:string|null;cause:string|null;pays_kind:string;amount:string|null;currency:string;sum_basis:string|null;offset_days:number|null;maximum_days:number|null}>(
    `SELECT id,seed_key,family_member_id::text,event_type,detail,cause,pays_kind,amount::text,currency,sum_basis::text,offset_days,maximum_days FROM coverage_rules
      WHERE account_id=$1 AND seed_key=ANY($2::text[]) AND origin<>'person' AND status<>'rejected' AND updated_at=created_at`,
    [accountId,[...new Set(seeds.flatMap(s=>[s.seedKey,legacyOf(s)]))]])).rows;
  const n=(v:string|number|null|undefined)=>v==null||v===""?"":String(Number(v));
  for(const row of held){
    const seed=bySeedKey.get(row.seed_key)??bySeedKey.get(row.seed_key+"#"+row.family_member_id);
    if(!seed||seed.familyMemberId!==row.family_member_id)continue;
    const same=row.event_type===seed.eventType&&(row.detail??"")===(seed.detail??"")&&(row.cause??"")===(seed.cause??"")&&row.pays_kind===seed.paysKind
      &&n(row.amount)===n(seed.amount)&&row.currency===seed.currency&&(seed.sumBasis==null||n(row.sum_basis)===n(seed.sumBasis))&&n(row.offset_days)===n(seed.offsetDays)&&n(row.maximum_days)===n(seed.maximumDays);
    if(same)continue;
    // Not a person's edit: updated_at is left alone, so the row stays the machine's to refresh.
    await query(`UPDATE coverage_rules SET event_type=$3,detail=$4,cause=$5,pays_kind=$6,amount=$7,currency=$8,sum_basis=$9,offset_days=$10,maximum_days=$11,conditions=$12::text[],note=$13,quote=$14
      WHERE account_id=$1 AND id=$2`,
      [accountId,row.id,seed.eventType,seed.detail,seed.cause,seed.paysKind,seed.amount,seed.currency,seed.sumBasis??(row.sum_basis==null?null:Number(row.sum_basis)),seed.offsetDays,seed.maximumDays,seed.conditions??[],seed.note,seed.quote]);
  }
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
  const contractOf=new Map<Seed,string>();
  for(const contract of contracts){
    const mine=new Set([...contract.documents,...contract.references].map(d=>d.id));
    const known=new Set<EventType>(existing.rows.filter(r=>r.policy_id&&mine.has(r.policy_id)&&r.pays_kind!=="stated"&&r.amount!=null).map(r=>r.event_type as EventType));
    // A multi-column table's row applies only to the person class or plan
    // tier of its column: a child gets the Child column, a Plan B employee
    // the Plan B column (policy_members.benefit_tier).
    const wording=wordingSeeds(contract,preferStatedRules(selectTierRows(catalog.filter(b=>mine.has(b.policyId)),
      policyId=>tiers.get(policyId+"|"+contract.ownerId)))).filter(w=>!known.has(w.eventType));
    for(const w of wording)if(w.paysKind!=="stated")known.add(w.eventType);
    const mineSeeds=[...wording,...scheduleSeeds(contract,known)];
    for(const seed of mineSeeds)contractOf.set(seed,contract.id+"|"+contract.ownerId);
    seeds.push(...mineSeeds);
  }
  // A seed's key is fixed by the row it came from, so a row seeded under an older rule is never seeded again: it kept
  // what that rule said (live, 21 Oct: a travel policy's liability-to-others row still "Accidental death S$500,000",
  // seeded the day before liability rows stopped being read as the person's own death cover). A machine-made row nobody
  // has touched takes what its seed says now. A row a person changed, and one they rejected, are left alone.
  await refreshSeededRows(accountId,seeds);
  // A rule read from the wording ("100% of the Sum Insured") and the sum on
  // the certificate live in different documents of the same contract. Join
  // them here, once, so the row carries its own figure.
  const unbased=await query<{id:string;policy_id:string|null;plan_name:string;family_member_id:string;event_type:string;detail:string|null;cause:string|null;note:string|null}>(
    "SELECT id,policy_id,plan_name,family_member_id,event_type,detail,cause,note FROM coverage_rules WHERE account_id=$1 AND pays_kind='percent_of_sum' AND sum_basis IS NULL AND policy_id IS NOT NULL",[accountId]);
  for(const row of unbased.rows){
    const contract=contracts.find(c=>c.ownerId===row.family_member_id&&[...c.documents,...c.references].some(d=>d.id===row.policy_id));
    if(!contract)continue;
    // The cover the row pays under, chosen by what it pays on (an accident-scale row belongs to the accident cover, a death
    // row to the life cover), the same join the Benefits page and the chat make. A group scheme lists every cover under
    // one scheme name, so a name match ("shares a word with the plan") picked whichever cover came first.
    const match=coverageForLedgerRow(contract,row);
    // A join made here, not a person's edit: updated_at is left alone, so a re-read still replaces the row.
    if(match?.amount!=null&&match.amount>0)await query("UPDATE coverage_rules SET sum_basis=$3 WHERE account_id=$1 AND id=$2",[accountId,row.id,match.amount]);
  }
  // A row joined before that rule existed keeps the cover it was joined to (live, 21 Oct: every scheme accident and
  // dismemberment row still a percentage of the S$1,000,000 term life, not the S$600,000 personal accident cover).
  // A machine-made row whose basis is one of its contract's cover amounts was joined, not printed, so it is joined
  // again: moved to the cover it pays under, or cleared when that cannot be told. A basis no cover carries (a fixed
  // limit the document printed) is left alone.
  // An older version of this join wrote updated_at (live: 52 rows stamped within 12 seconds, 29 minutes after one
  // seeding on 27 Sep), so updated_at alone cannot tell a person's edit. Neither can status: wording rows are seeded
  // confirmed, and an edit can be sent as "proposed" (Critic R75-1, R75-2). What a person cannot do is change dozens of
  // rows within a minute: a row stamped together with at least MACHINE_BATCH other machine-made rows was stamped by a
  // machine and is joined again like an untouched one. Any other changed row may hold a person's figure: it is never
  // changed silently; it says it may be worked out from the wrong cover.
  const joined=await query<{id:string;policy_id:string;family_member_id:string;event_type:string;detail:string|null;cause:string|null;note:string|null;sum_basis:string;currency:string;conditions:string[]|null;machine:boolean}>(
    `SELECT c.id,c.policy_id,c.family_member_id,c.event_type,c.detail,c.cause,c.note,c.sum_basis::text,c.currency,c.conditions,
       (c.updated_at=c.created_at OR (SELECT count(*) FROM coverage_rules o WHERE o.account_id=c.account_id AND o.id<>c.id AND o.origin<>'person'
          AND o.updated_at<>o.created_at AND o.updated_at BETWEEN c.updated_at-interval '60 seconds' AND c.updated_at+interval '60 seconds')>=$2) AS machine
     FROM coverage_rules c WHERE c.account_id=$1 AND c.pays_kind='percent_of_sum' AND c.sum_basis IS NOT NULL AND c.policy_id IS NOT NULL AND c.origin<>'person' AND c.status<>'rejected'`,
    [accountId,MACHINE_BATCH]);
  for(const row of joined.rows){
    const contract=contracts.find(c=>c.ownerId===row.family_member_id&&[...c.documents,...c.references].some(d=>d.id===row.policy_id));
    if(!contract)continue;
    const stored=Number(row.sum_basis);
    if(!contract.coverages.some(c=>c.amount!=null&&Number(c.amount)===stored))continue;
    const match=coverageForLedgerRow(contract,row);
    const basis=match?.amount!=null&&match.amount>0?Number(match.amount):null;
    if(basis===stored)continue;
    // Clearing applies only when the covers carry different amounts: then the stored one may be the wrong one.
    if(basis==null&&new Set(contract.coverages.filter(c=>c.amount!=null&&c.amount>0).map(c=>Number(c.amount))).size<2)continue;
    if(!row.machine){
      const note=wrongCoverNote(stored,basis,row.currency,row.conditions);
      if(note)await query("UPDATE coverage_rules SET conditions=array_append(coalesce(conditions,ARRAY[]::text[]),$3) WHERE account_id=$1 AND id=$2",[accountId,row.id,note]);
      continue;
    }
    await query("UPDATE coverage_rules SET sum_basis=$3 WHERE account_id=$1 AND id=$2",[accountId,row.id,basis]);
  }
  // Round 10: one lookup for the keys already in the ledger and one insert for
  // the rest, instead of a lookup and an insert per seed (two queries for each
  // of a hundred-odd rows in a ten-person household, on every seeding).
  const legacyOf=(s:Seed)=>s.seedKey.replace(/\|member:[^|]+$/,"");
  const keys=[...new Set(seeds.flatMap(s=>[s.seedKey,legacyOf(s)]))];
  const present=keys.length?(await query<{seed_key:string;family_member_id:string|null}>(
    "SELECT seed_key,family_member_id::text FROM coverage_rules WHERE account_id=$1 AND seed_key=ANY($2::text[])",[accountId,keys])).rows:[];
  const existingKeys=new Set(present.map(r=>r.seed_key));
  const legacyHeld=new Set(present.map(r=>r.family_member_id+"|"+r.seed_key));
  // Round 9: one ledger row per fact. The same rule can be read twice -- two
  // rows of one table, the wording and the certificate of one contract, a
  // re-read whose rows got new ids while a person's edit kept the old row --
  // and each read has its own seed key. A fact (person, contract, event,
  // cause, what it pays, amount, currency, basis, days) already held by a row
  // of an ACTIVE policy of the same contract (any status: a rejection
  // stands), or by an earlier seed of this pass (the catalogue's total order
  // makes that the same one every time), is not added again. A row of a
  // deleted or superseded policy holds nothing: the fact is seeded afresh
  // for the live document.
  const n=(v:string|number|null|undefined)=>v==null||v===""?"":String(Number(v));
  const factKey=(contract:string,r:{eventType:string;detail:string|null;cause:string|null;paysKind:string;amount:string|number|null;currency:string;sumBasis:string|number|null;offsetDays:number|null;maximumDays:number|null})=>
    [contract,r.eventType,(r.detail??"").toLowerCase(),r.cause??"",r.paysKind,n(r.amount),r.currency,n(r.sumBasis),n(r.offsetDays),n(r.maximumDays)].join("|");
  const heldRows=(await query<{policy_id:string;family_member_id:string;seed_key:string|null;event_type:string;detail:string|null;cause:string|null;pays_kind:string;amount:string|null;currency:string;sum_basis:string|null;offset_days:number|null;maximum_days:number|null}>(
    "SELECT policy_id::text,family_member_id::text,seed_key,event_type,detail,cause,pays_kind,amount::text,currency,sum_basis::text,offset_days,maximum_days FROM coverage_rules WHERE account_id=$1 AND policy_id IS NOT NULL AND "+ACTIVE_POLICY_GUARD,[accountId]).catch(()=>({rows:[]}))).rows;
  const heldFacts=new Map<string,Set<string|null>>();
  for(const r of heldRows)for(const contract of contracts){
    if(contract.ownerId!==r.family_member_id||![...contract.documents,...contract.references].some(d=>d.id===r.policy_id))continue;
    const k=factKey(contract.id+"|"+contract.ownerId,{eventType:r.event_type,detail:r.detail,cause:r.cause,paysKind:r.pays_kind,amount:r.amount,currency:r.currency,sumBasis:r.sum_basis,offsetDays:r.offset_days,maximumDays:r.maximum_days});
    (heldFacts.get(k)??heldFacts.set(k,new Set()).get(k)!).add(r.seed_key);
  }
  const seededFacts=new Set<string>();
  const oneRowPerFact=(s:Seed)=>{
    const k=factKey(contractOf.get(s)??s.policyId+"|"+s.familyMemberId,s);
    const held=heldFacts.get(k);
    if(held&&![...held].every(key=>key===s.seedKey||key===legacyOf(s)))return false;
    if(seededFacts.has(k))return false;
    seededFacts.add(k);return true;
  };
  const fresh=seeds.filter(oneRowPerFact).filter(s=>{
    // Two insured people under one certificate ("Insured persons: Mei Ling;
    // Wei Jie") read the same row: each gets their own ledger row. A row
    // seeded under the older person-less key is that person's already.
    const legacy=legacyOf(s);
    if(legacy!==s.seedKey&&legacyHeld.has(s.familyMemberId+"|"+legacy))return false;
    return !existingKeys.has(s.seedKey);
  });
  let added=0;
  for(let i=0;i<fresh.length;i+=200){
    const batch=fresh.slice(i,i+200).map(s=>({family_member_id:s.familyMemberId,policy_id:s.policyId,plan_name:s.planName,insurer:s.insurer,event_type:s.eventType,detail:s.detail,cause:s.cause,
      pays_kind:s.paysKind,amount:s.amount,currency:s.currency,sum_basis:s.sumBasis,offset_days:s.offsetDays,maximum_days:s.maximumDays,conditions:s.conditions??[],note:s.note,source_page:s.sourcePage,
      quote:s.quote,origin:s.origin,inferred:s.inferred,status:s.status,seed_key:s.seedKey}));
    const r=await query<{id:string}>(
      `INSERT INTO coverage_rules(account_id,family_member_id,policy_id,plan_name,insurer,event_type,detail,cause,pays_kind,amount,currency,sum_basis,offset_days,maximum_days,conditions,note,source_page,quote,origin,inferred,status,seed_key)
       SELECT $1,x.family_member_id,x.policy_id,x.plan_name,x.insurer,x.event_type,x.detail,x.cause,x.pays_kind,x.amount,x.currency,x.sum_basis,x.offset_days,x.maximum_days,x.conditions,x.note,x.source_page,x.quote,x.origin,x.inferred,x.status,x.seed_key
         FROM ROWS FROM (jsonb_to_recordset($2::jsonb) AS (family_member_id uuid,policy_id uuid,plan_name text,insurer text,event_type text,detail text,cause text,pays_kind text,amount numeric,currency text,
           sum_basis numeric,offset_days int,maximum_days int,conditions text[],note text,source_page int,quote text,origin text,inferred boolean,status text,seed_key text))
         WITH ORDINALITY AS x(family_member_id,policy_id,plan_name,insurer,event_type,detail,cause,pays_kind,amount,currency,sum_basis,offset_days,maximum_days,conditions,note,source_page,quote,origin,inferred,status,seed_key,n)
        ORDER BY x.n
       ON CONFLICT (account_id,seed_key) WHERE seed_key IS NOT NULL DO NOTHING RETURNING id`,
      [accountId,JSON.stringify(batch)]);
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

/** Either/or amounts for ledger rows (lib/policies/amount-alternatives.ts): the same benefit worked out two ways for one
 * person. A ledger keeps one row per event, so the other way is usually not a row of its own; the group names it by its
 * benefit ("benefit:<id>") and by its ledger row where there is one. Keyed by ledger row id. */
export async function ledgerAlternatives(accountId:string,people:ClaimPerson[]):Promise<Map<string,AmountAlternatives>>{
  const out=new Map<string,AmountAlternatives>();
  const seeded=(await query<{id:string;seed_key:string;family_member_id:string}>(
    "SELECT id::text,seed_key,family_member_id::text FROM coverage_rules WHERE account_id=$1 AND seed_key LIKE 'benefit:%' AND status<>'rejected'",[accountId]).catch(()=>({rows:[]}))).rows;
  if(!seeded.length)return out;
  const ledgerRowFor=new Map(seeded.map(r=>[split(r.seed_key)+"|"+r.family_member_id,r.id]));
  const inventory=await loadPolicyInventory(accountId,people);
  const documentIds=[...new Set(inventory.contracts.flatMap(c=>[...c.documents,...c.references].map(d=>d.id)))];
  if(!documentIds.length)return out;
  const catalog=await loadBenefitCatalog(accountId,documentIds).catch(()=>[] as CatalogBenefit[]);
  const names=new Map(inventory.contracts.flatMap(c=>[...c.documents,...c.references]).map(d=>[d.id,d.product_name??d.original_filename]));
  for(const contract of inventory.contracts){
    const docs=new Set([...contract.documents,...contract.references].map(d=>d.id));
    const groups=amountAlternatives(contract,catalog.filter(b=>docs.has(b.policyId)),id=>names.get(id)??"Your document");
    for(const [benefitId,group] of groups){
      const rowId=ledgerRowFor.get(benefitId+"|"+contract.ownerId);
      if(!rowId)continue;
      out.set(rowId,{...group,options:group.options.map(o=>({...o,rowId:ledgerRowFor.get(o.rowId+"|"+contract.ownerId)??"benefit:"+o.rowId}))});
    }
  }
  return out;
  function split(seedKey:string){return seedKey.split("|")[0].slice("benefit:".length);}
}

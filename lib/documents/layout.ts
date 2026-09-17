/** Recovering the shape of a page, not just its words.
 *
 * Insurance documents are overwhelmingly benefit TABLES: a name, what it pays,
 * a limit. Joining PDF.js text items with spaces destroys that — a two-column
 * page interleaves into nonsense and "Simple fracture … 25% of S$5,000"
 * dissolves into prose that no extractor can tie back together.
 *
 * PDF.js already gives every item an x/y position. Keeping it costs nothing and
 * turns the same page into lines and cells, which is what a benefit schedule
 * actually is. Nothing here uses a model: it is geometry. */
export type TextItem = { text:string; x:number; y:number; w:number };
export type PageLine = { cells:string[]; text:string; y:number };
export type PageLayout = { text:string; lines:PageLine[] };

/** A column break is a vertical strip of the page with no text in it at all. */
export function columnBands(items:TextItem[],pageWidth:number,minimumGutter=26){
  const width=Number.isFinite(pageWidth)&&pageWidth>0?pageWidth:612;
  const bins=new Array(Math.max(1,Math.ceil(width/4))).fill(0);
  for(const item of items){
    const from=Math.max(0,Math.floor(item.x/4)),to=Math.min(bins.length-1,Math.floor((item.x+item.w)/4));
    for(let bin=from;bin<=to;bin++)bins[bin]++;
  }
  const gutters:number[]=[];let run=0;
  for(let bin=0;bin<bins.length;bin++){
    if(bins[bin]===0){run++;continue;}
    // Ignore the page margins: only a gap with text on BOTH sides is a column.
    if(run*4>=minimumGutter&&bin-run>6&&bin<bins.length-6)gutters.push((bin-run/2)*4);
    run=0;
  }
  const edges=[0,...gutters,width];
  return edges.slice(0,-1).map((left,index)=>({left,right:edges[index+1]}));
}
/** Items sharing a baseline form a line; a wide horizontal gap starts a new cell. */
export function lineFrom(items:TextItem[],cellGap=10):PageLine{
  const ordered=[...items].sort((a,b)=>a.x-b.x);
  const cells:string[]=[];let current="",cursor:number|null=null;
  for(const item of ordered){
    const piece=item.text.trim();
    if(!piece){cursor=item.x+item.w;continue;}
    if(cursor!==null&&item.x-cursor>cellGap){if(current.trim())cells.push(current.trim());current="";}
    else if(cursor!==null&&item.x-cursor>1.2&&current)current+=" ";
    current+=piece;cursor=item.x+item.w;
  }
  if(current.trim())cells.push(current.trim());
  return {cells,text:cells.join("\t"),y:ordered[0]?.y??0};
}
export function renderPageLayout(items:TextItem[],pageWidth:number):PageLayout{
  const usable=items.filter(item=>item.text.trim().length>0);
  if(!usable.length)return {text:"",lines:[]};
  const lines:PageLine[]=[];
  // Read each column top to bottom before moving right, the way a person does.
  for(const band of columnBands(usable,pageWidth)){
    const inBand=usable.filter(item=>{
      const middle=item.x+item.w/2;
      return middle>=band.left&&middle<band.right;
    });
    if(!inBand.length)continue;
    const byBaseline=new Map<number,TextItem[]>();
    for(const item of inBand){
      const key=Math.round(item.y/4)*4;
      if(!byBaseline.has(key))byBaseline.set(key,[]);
      byBaseline.get(key)!.push(item);
    }
    for(const [,row] of [...byBaseline.entries()].sort((a,b)=>b[0]-a[0])){
      const line=lineFrom(row);
      if(line.cells.length)lines.push(line);
    }
  }
  // Tabs and newlines survive into storage, so table rows can be recovered
  // later by splitting. Quote matching normalises whitespace, so every existing
  // exact-quote check keeps working against this text.
  return {text:lines.map(line=>line.text).join("\n"),lines};
}
const AMOUNT=/(?:S?\$\s?[\d,]+(?:\.\d{1,2})?|\d{1,3}(?:\.\d+)?\s?%)/;
/** Limits are rarely bare figures. "Up to S$500 per incident" and "25% of the
 * Sum Insured" are both value cells; a paragraph that happens to mention a
 * dollar figure is not. Length is what separates a cell from prose. */
function isValueCell(cell:string){
  if(!AMOUNT.test(cell)||cell.length>80)return false;
  return /^(?:S?\$|\d)/.test(cell)||/^(?:up to|max(?:imum)?|not exceed(?:ing)?|limited to|per|from)\b/i.test(cell);
}
export type BenefitRow={label:string;value:string;line:string;
  /** Where this row sits in the page's lines, so a heading above it (for
   * example "Compensation (% of S$5,000)") can be applied to it and not to a
   * different table further down the same page. */
  index:number};
/** A benefit-schedule row: a label cell, then a cell that starts with money or
 * a percentage. Deterministic, and wrong far less often than prose matching. */
/** A sub-row of a numbered benefit: "(b) Whole eye" under "2. Permanent Total
 * Loss of". On the page the parent is obvious to the eye; in a flat list of
 * rows it is lost, and "(b) Whole eye" is not something a person can check. */
const SUB_ROW=/^\(?([a-z])\)\s+/i;
function parentStem(label:string){
  // "2. Permanent Total Loss of (a) Sight in at least one eye" -> the part
  // before the first marker, kept only when it is a numbered heading.
  if(!/^\d+[.)]/.test(label))return null;
  const marker=label.search(/\(?[a-z]\)\s/i);
  if(marker<1)return null;
  const stem=label.slice(0,marker).replace(/\s+/g," ").trim();
  return stem.length>=6&&stem.length<=90?stem:null;
}
/** A label that names nothing: "35-39", "34 and below", "45". These are the
 * left column of a PREMIUM rate table, not a benefit schedule, and the shapes
 * are close enough that a parser reading one as the other would put
 * "35-39 pays S$30.00" in front of the user as if it were cover. */
const NOT_A_BENEFIT_LABEL=[
  /^\d{1,3}\s*(?:[-–—]|to)\s*\d{1,3}$/,
  /^(?:ages?d?\s*)?\d{1,3}\s*(?:years?(?:\s*old)?\s*)?(?:and|or)?\s*(?:below|above|under|over|younger|older)$/i,
  /^\d{1,3}(?:\s*years?(?:\s*old)?)?$/i,
];
/** "Standard MediShield Life premium  $637.00" is money the household PAYS.
 * Read as cover it would appear on the schedule as a benefit worth S$637. A
 * waiver or a refund of premium, on the other hand, really is a benefit. */
const PREMIUM_LABEL=/\bpremiums?\b/i,PREMIUM_BENEFIT=/\b(?:waiv\w+|refund\w*|return of premium|benefit)\b/i;
/** Money the person bears before the insurer pays: never a benefit. */
const COST_SHARING=/\b(?:deductible|co-?insurance|co-?payment|excess|pro-?ration)\b/i;
function namesABenefit(label:string){
  if(PREMIUM_LABEL.test(label)&&!PREMIUM_BENEFIT.test(label))return false;
  if(COST_SHARING.test(label))return false;
  // A bare year is a real label — a payout that steps up each year is printed
  // exactly that way — so only the age-band shapes are excluded.
  return !NOT_A_BENEFIT_LABEL.some(pattern=>pattern.test(label.trim()));
}
/** A benefit name that runs onto the next line. "4. Loss of arm (at shoulder,
 * between shoulder and elbow,  100%" continues "at elbow, between elbow and
 * wrist)" — and a label cut off mid-phrase is not something a person can check
 * against their policy. Only a line with no amount of its own, that clearly
 * continues the one above, is pulled in. */
const UNFINISHED=/[,&]$|\b(?:and|or|of|to|the|in|for|with|upon|between|from|at|due)$/i;
function withContinuation(label:string,lines:PageLine[],index:number){
  let text=label,valueSuffix="";
  for(let next=index+1;next<lines.length&&next<=index+2;next++){
    const line=lines[next];
    if(line.cells.some(isValueCell))break;
    const piece=line.cells.join(" ").replace(/\s+/g," ").trim();
    if(!piece||piece.length>70||/^\d+[.)]/.test(piece))break;
    // "15% of Sum Insured or" / "up to S$50,000, whichever is lesser": the
    // second line finishes the AMOUNT, not the name. Reading it as part of the
    // name would leave a half-stated rule looking complete.
    if(AMOUNT.test(piece)||/whichever/i.test(piece)){valueSuffix=" "+piece;break;}
    // Either this line opened mid-phrase, or the next one starts mid-phrase.
    // A short or code-like label is never extended by the line below it: on a
    // two-column page that line belongs to the other column.
    if(!UNFINISHED.test(text)&&text.length<8)break;
    if(!UNFINISHED.test(text)&&!/^[a-z]/.test(piece)&&!/\)$/.test(piece))break;
    if(text.length+piece.length+1>140)break;
    text=text+" "+piece;
  }
  return {label:text,valueSuffix};
}
/** Some tables of percentages are not benefit schedules at all. A pro-ration
 * factor says how a bill is scaled before a claim is computed; "Class B1 34%"
 * is not cover and must never appear as cover. */
const NOT_A_BENEFIT_TABLE=/pro-?ration factor|premium rate|schedule of premiums|premium table/i;
const NEW_TABLE=/^table\s+[a-z][:.]/i;
export function benefitRows(lines:PageLine[]):BenefitRow[]{
  const rows:BenefitRow[]=[];
  let stem:string|null=null,suppressed=false;
  for(const [index,line] of lines.entries()){
    const whole=line.text.replace(/\s+/g," ").trim();
    if(NOT_A_BENEFIT_TABLE.test(whole))suppressed=true;
    else if(suppressed&&NEW_TABLE.test(whole))suppressed=false;
    if(suppressed)continue;
    const valueIndex=line.cells.findIndex(isValueCell);
    if(valueIndex<0||line.cells.length<2){
      // "2. Permanent Total Loss of" carries no amount of its own but names the
      // rows under it, which would otherwise read as "(b) Whole eye".
      const heading=line.cells.join(" ").replace(/\s+/g," ").trim();
      if(/^\d+[.)]\s+\S/.test(heading)&&heading.length<=90&&!AMOUNT.test(heading))stem=heading;
      continue;
    }
    if(valueIndex<1)continue;
    const stated=line.cells.slice(0,valueIndex).join(" ").replace(/\s+/g," ").trim();
    // Judge what the row itself says before anything is appended to it, so a
    // premium rate table's "50-54" cannot be rescued by the prose beside it.
    if(stated.length<2||stated.length>140||!namesABenefit(stated))continue;
    const continued=withContinuation(stated,lines,index);
    let label=continued.label;
    if(label.length<2||label.length>140)continue;
    // A numbered row that itself carries "(a)" opens a group; the "(b)", "(c)"
    // rows beneath it inherit its wording so each one stands on its own.
    const opened=parentStem(label);
    if(opened)stem=opened;
    else if(stem&&SUB_ROW.test(label)&&!/^\d/.test(label))label=stem+" "+label;
    else if(/^\d+[.)]/.test(label))stem=null;
    if(label.length>140||!namesABenefit(label))continue;
    rows.push({label,value:(line.cells[valueIndex].trim()+continued.valueSuffix).trim(),line:line.text,index});
  }
  return rows;
}

/** Rebuilds lines and cells from stored page text.
 *
 * Tabs and newlines are preserved when a page is saved, so a document already
 * in the database can be re-read as a table without re-opening the PDF. */
export function linesFromStoredText(text:string):PageLine[]{
  return (text??"").split("\n").map((line,index)=>{
    const cells=line.split("\t").map(cell=>cell.trim()).filter(Boolean);
    return {cells,text:line,y:-index};
  }).filter(line=>line.cells.length>0);
}
export function benefitRowsFromText(text:string){return benefitRows(linesFromStoredText(text));}

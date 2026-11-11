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
export type PageLine = { cells:string[]; text:string; y:number;
  /** Where each cell starts and ends on the page (geometry-built lines only). */
  xs?:number[]; xe?:number[];
  /** The cells of a table row placed in their columns, empty ones kept, so a
   * value always sits under its own column heading. */
  rawCells?:string[] };
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
  const cells:string[]=[],xs:number[]=[],xe:number[]=[];let current="",cursor:number|null=null,start=0;
  for(const item of ordered){
    const piece=item.text.trim();
    if(!piece){cursor=item.x+item.w;continue;}
    // Two figures printed side by side with no gap ("50,000.00" "50,000.00") are two cells, never one glued number
    // "50,000.0050,000.00": a complete decimal amount followed by another digit starts a new cell (a household's new
    // documents, 24 Oct: Prudential schedules).
    const glued=cursor!==null&&/(?:\d\.\d{2}|\d,\d{3})$/.test(current)&&/^[\d(]/.test(piece);
    if(cursor!==null&&(item.x-cursor>cellGap||glued)){if(current.trim()){cells.push(current.trim());xs.push(start);xe.push(cursor);}current="";}
    else if(cursor!==null&&item.x-cursor>1.2&&current)current+=" ";
    if(!current)start=item.x;
    current+=piece;cursor=item.x+item.w;
  }
  if(current.trim()){cells.push(current.trim());xs.push(start);xe.push(cursor??start);}
  return {cells,text:cells.join("\t"),y:ordered[0]?.y??0,xs,xe};
}

/** Tables whose cells wrap onto several printed lines.
 *
 * A schedule cell like "Surgical benefits (including day surgery)" wraps to
 * "Surgical benefits (including day" / "surgery)", and the wrapped half of
 * every cell in that row sits on the next printed line. Read line by line
 * the row falls apart into fragments and each value lands in the wrong
 * column. Here a table is recognised by its column starts (a line of three
 * or more cells, and the lines beneath whose every cell starts under one of
 * those columns and stays inside it); lines of one table row are joined back
 * by their spacing (the lines of one row are closer together than two rows);
 * and every row is emitted with its cells in their columns, empty cells kept
 * as empty tab-separated slots. Pure geometry. */
const COLUMN_TOLERANCE=4;
function columnOf(x:number,cols:number[]){
  let best=-1,distance=Infinity;
  cols.forEach((col,index)=>{const d=Math.abs(col-x);if(d<distance){distance=d;best=index;}});
  return distance<=COLUMN_TOLERANCE?best:-1;
}
function fitsColumns(line:PageLine,cols:number[]){
  if(!line.xs||!line.xe||!line.cells.length)return false;
  const used=new Set<number>();
  for(let i=0;i<line.cells.length;i++){
    const col=columnOf(line.xs[i],cols);
    if(col<0||used.has(col))return false;
    used.add(col);
    // A cell running past the start of the next column is prose, not a cell.
    if(col+1<cols.length&&line.xe[i]>cols[col+1]+1)return false;
  }
  return true;
}
function joinWrapped(a:string,b:string){
  if(!a)return b;if(!b)return a;
  // "Sectio" + "n": a word the column was too narrow for.
  if(/[A-Za-z]$/.test(a)&&/^[a-z]{1,3}$/.test(b))return a+b;
  return a+" "+b;
}
function slotted(cells:string[]):PageLine{
  const rawCells=cells.map(c=>c.trim());
  const kept=rawCells.filter(Boolean);
  return {cells:kept,rawCells,text:rawCells.join("\t").replace(/\t+$/,""),y:0};
}
export function assembleTables(lines:PageLine[]):PageLine[]{
  const out:PageLine[]=[];
  let i=0;
  while(i<lines.length){
    const head=lines[i];
    if(!head.xs||head.cells.length<3){out.push(head);i++;continue;}
    const cols=head.xs.slice();
    const block=[head];let j=i+1;
    while(j<lines.length&&fitsColumns(lines[j],cols)){block.push(lines[j]);j++;}
    if(block.length<2){out.push(head);i++;continue;}
    const gaps=block.slice(1).map((line,k)=>block[k].y-line.y).filter(gap=>gap>0);
    const smallest=gaps.length?Math.min(...gaps):0,largest=gaps.length?Math.max(...gaps):0;
    // Joining needs two kinds of spacing: within a row and between rows.
    const wraps=smallest>0&&largest>smallest*1.25;
    let current:string[]|null=null,currentY=0,lastY=0;
    const flush=()=>{if(current){const line=slotted(current);line.y=currentY;out.push(line);}current=null;};
    for(const line of block){
      const cells=new Array(cols.length).fill("");
      line.cells.forEach((cell,index)=>{const col=columnOf(line.xs![index],cols);cells[col]=joinWrapped(cells[col],cell);});
      if(current&&wraps&&lastY-line.y<=smallest*1.15){
        cells.forEach((cell,col)=>{if(cell)current![col]=joinWrapped(current![col],cell);});
      }else{flush();current=cells;currentY=line.y;}
      lastY=line.y;
    }
    flush();
    i=j;
  }
  return out;
}
/** A label/amount table with nothing spanning the page ("Fracture of arm" …
 * "S$1,000") has an empty vertical strip between its columns, exactly like a
 * two-column page. Read as two columns, every label was separated from its
 * amount and the whole schedule was lost. Two neighbouring bands are one
 * table when the right band is mostly amount cells that sit on the same
 * baselines as lines in the left band. */
function mergeTableBands(bands:{left:number;right:number}[],items:TextItem[]){
  const out=[...bands];
  const baselines=(band:{left:number;right:number})=>{
    const rows=new Map<number,TextItem[]>();
    for(const item of items){
      const middle=item.x+item.w/2;
      if(middle<band.left||middle>=band.right)continue;
      const key=Math.round(item.y/4)*4;
      rows.set(key,[...(rows.get(key)??[]),item]);
    }
    return rows;
  };
  // The label column may not be the band immediately to the left: a stray
  // item (a centred page number) can open a narrow band in between. The
  // amounts band joins the nearest band to its left whose lines it sits on,
  // taking in anything between them.
  for(let i=1;i<out.length;){
    const right=baselines(out[i]);
    const rightLines=[...right.entries()].map(([y,row])=>({y,text:lineFrom(row).cells.join(" ")}));
    const valueLines=rightLines.filter(line=>isValueCell(line.text));
    // A short table ("Death benefit  US$350,000" / "Terminal illness benefit
    // Advance of the death benefit") has too few amounts to go by: it is
    // still a table when every right-hand cell is short and sits beside a
    // label. Two columns of prose have long lines.
    const shortCells=rightLines.length>0&&rightLines.every(line=>line.text.length<=32);
    let merged=false;
    // A "label :" / value form ("Policy Number:" beside "63639755", "Basic Plan:" beside "PruFlexiCash Protection Plus (7th
    // Series)"): its values can be long names, but each sits on the baseline of a label that ends with a colon
    // (a household's new documents, 24 Oct: Prudential schedules read with every label first, then every value).
    for(let j=i-1;j>=0&&!merged;j--){
      const left=baselines(out[j]);
      const labels=[...left.entries()].map(([y,row])=>({y,text:lineFrom(row).cells.join(" ")}));
      const colon=labels.filter(line=>/:\s*$/.test(line.text));
      const besideColon=(line:{y:number})=>[line.y,line.y-4,line.y+4].some(y=>colon.some(c=>c.y===y));
      if(colon.length>=3&&colon.length/labels.length>=0.6&&rightLines.length>=2&&rightLines.filter(besideColon).length/rightLines.length>=0.8){
        out.splice(j,i-j+1,{left:out[j].left,right:out[i].right});i=j+1;merged=true;
      }
      break;
    }
    if(merged)continue;
    if((valueLines.length>=1||shortCells&&rightLines.length>=2)&&(valueLines.length>=2&&valueLines.length/rightLines.length>=0.6||shortCells)){
      for(let j=i-1;j>=0;j--){
        const left=baselines(out[j]);
        const beside=(line:{y:number})=>left.has(line.y)||left.has(line.y-4)||left.has(line.y+4);
        // Only the amounts need a label beside them; a stray page number in
        // the same band does not. A short-cell table needs every cell beside one.
        // Lines above or below the whole label column (a page number in the
        // footer) are not cells of the table.
        const ys=[...left.keys()],top=Math.max(...ys)+4,bottom=Math.min(...ys)-4;
        const within=rightLines.filter(line=>line.y<=top&&line.y>=bottom);
        // Round 10: a further column of a table whose first columns are already
        // read as one ("Maximum" / "30 days per admission" / "-") prints no
        // amounts, but every one of its short cells sits beside a row of that
        // table (a line of two or more cells). Read apart, those cells landed at
        // the bottom of the page, cut off from their rows.
        const tableRowBeside=(line:{y:number})=>[line.y,line.y-4,line.y+4].some(y=>{const row=left.get(y);return !!row&&lineFrom(row).cells.length>=2;});
        const aligned=valueLines.length>=2&&valueLines.length/rightLines.length>=0.6
          ?valueLines.filter(beside).length/valueLines.length>=0.8
          :within.length>0&&within.some(line=>isValueCell(line.text))&&within.every(beside)
            ||(shortCells&&within.length>=2&&within.length===rightLines.length&&within.every(tableRowBeside))
            // ...or a column of bare figures and dashes ("Qty" 6, 1, -; "Amount (S$)" 4,830.00), each
            // beside a label: an itemised bill or statement whose amounts print no currency of their own.
            ||(shortCells&&within.length>=3&&within.length===rightLines.length&&within.every(beside)
              &&within.filter(line=>/^(?:[\d][\d,]*(?:\.\d+)?%?|[-–—])$/.test(line.text.trim())).length>=Math.max(2,Math.ceil((within.length-1)*0.75)))
            // ...or a schedule's value columns of bare figures ("100,000.00 100,000.00" under "Sum Assured" / "Premium"),
            // each line beside a label: read apart, every label came before every value (a household's new documents, 24 Oct).
            ||(within.length>=2&&within.length===rightLines.length&&within.every(beside)
              &&within.filter(line=>/^(?:(?:[\d][\d,]*\.\d{2}|\d{1,3}(?:,\d{3})+|[-–—])(?:\s+|$))+$/.test(line.text.trim())).length>=Math.max(2,Math.ceil(within.length*0.75)));
        if(aligned){out.splice(j,i-j+1,{left:out[j].left,right:out[i].right});i=j+1;merged=true;break;}
      }
    }
    if(!merged)i++;
  }
  return out;
}
export function renderPageLayout(items:TextItem[],pageWidth:number):PageLayout{
  const usable=items.filter(item=>item.text.trim().length>0);
  if(!usable.length)return {text:"",lines:[]};
  const lines:PageLine[]=[];
  // Read each column top to bottom before moving right, the way a person does.
  for(const band of mergeTableBands(columnBands(usable,pageWidth),usable)){
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
    const bandLines:PageLine[]=[];
    for(const [,row] of [...byBaseline.entries()].sort((a,b)=>b[0]-a[0])){
      const line=lineFrom(row);
      if(line.cells.length)bandLines.push(line);
    }
    lines.push(...assembleTables(bandLines));
  }
  // Tabs and newlines survive into storage, so table rows can be recovered
  // later by splitting. Quote matching normalises whitespace, so every existing
  // exact-quote check keeps working against this text.
  return {text:lines.map(line=>line.text).join("\n"),lines};
}
import { WORDED_SHARE_CELL } from "@/lib/policies/word-fractions";
/** A printed currency marker in front of an amount: a dollar sign with its
 * country prefix (S$, US$, HK$, A$ …), an ISO code (SGD, USD, EUR …), RM, € or
 * £. Only "S$"-style cells used to count, so a travel schedule printing
 * "US$250,000" or "USD 500,000" lost those rows without a trace. */
export const CURRENCY_MARKER=String.raw`(?:(?:US|S|SG|A|AU|HK|NZ|C|CA)?\$|SGD|USD|EUR|GBP|AUD|HKD|MYR|NZD|CAD|JPY|CNY|CHF|IDR|INR|PHP|THB|RM|(?<![A-Za-z])(?:Rp|Rs)\.?|€|£|¥|₹|₱|฿)`;
const AMOUNT=new RegExp(String.raw`(?:${CURRENCY_MARKER}\s?[\d,]+(?:\.\d{1,2})?|\d{1,3}(?:\.\d+)?\s?%)`);
const VALUE_START=new RegExp(String.raw`^(?:${CURRENCY_MARKER}\s?\d|\d)`);
/** Limits are rarely bare figures. "Up to S$500 per incident" and "25% of the
 * Sum Insured" are both value cells; a paragraph that happens to mention a
 * dollar figure is not. Length is what separates a cell from prose. */
/** "150 per day": a rate whose currency the document does not print. */
const BARE_RATE=/^\d[\d,]*(?:\.\d{1,2})?\s*(?:per|\/|a)\s*(?:day|night|week|month|year)\b/i;
function isValueCell(cell:string){
  if(cell.length<=80&&BARE_RATE.test(cell))return true;
  // "One twelfth of Sum Insured": a share printed in words is the row's amount, on a closed list of fractions.
  if(WORDED_SHARE_CELL.test(cell.replace(/\s+/g," ").trim()))return true;
  if(!AMOUNT.test(cell)||cell.length>80)return false;
  // "As charged, up to RM 30,000": a reimbursement with its cap is an amount cell (stored as as-charged, never a formula).
  return VALUE_START.test(cell)||/^(?:up to|max(?:imum)?|not exceed(?:ing)?|limited to|per|from|as charged)\b/i.test(cell);
}
export type BenefitRow={label:string;value:string;line:string;
  /** Where this row sits in the page's lines, so a heading above it (for
   * example "Compensation (% of S$5,000)") can be applied to it and not to a
   * different table further down the same page. */
  index:number;
  /** In a table with several value columns, the heading of the column this
   * value is in: the plan tier, ward class or person class it applies to
   * ("Plan A", "Private hospital", "Child"). Null for a single-value row. */
  tier?:string|null;
  /** True when the row came from a column-aware table read. */
  fromTable?:boolean};
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
  if(PAYMENT_LABEL.test(label))return false;
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
const UNFINISHED=/[,&]$|\b(?:and|or|of|to|the|in|for|with|upon|between|from|at|due|untuk|dan|atau|bagi|dari|daripada|kepada|dengan|pada|akibat)$/i;
/** A row whose cells wrapped onto the next line, quoted cell by cell: the name, then the amount, each in the document's
 * own words. Quoting the two printed lines as they run ("up to maximum Coronary Artery of S$25,000") would put the
 * name in the middle of the amount. */
function wrappedLine(label:string,value:string){return label+"\t"+value.trim();}
/** An amount cell that stops on the words leading into its cap or its second half: "up to maximum", "subject to a
 * maximum", "up to", "or". The rest of the amount is on the next line. */
const VALUE_UNFINISHED=/\b(?:of|to|up\s+to|maximum|max\.?|limit\s+of|limited\s+to|not\s+exceeding|subject\s+to|sehingga(?:\s+maksimum)?|maksimum|hingga)$/i;
/** The rest of an amount on its own: a bare sum ("£10,000", "RM20,000") or words that cannot start an amount ("of S$25,000"). */
const AMOUNT_REST=/^(?:[a-z]|(?:[A-Z]{1,3}\s?)?[$£€¥₹]?\s?\d[\d,.]*(?:\s?(?:k|m|million|thousand))?$|(?:S\$|RM|HK\$|US\$|A\$|Rp|Rs\.?|£|€|¥|₹)\s?\d[\d,.]*$)/u;
/** A line printed as a row of its own: a name in the left cell and an amount in the right one. */
function labelAmountRow(line:PageLine|undefined){
  if(!line||line.cells.length!==2)return false;
  const left=line.cells[0]?.trim()??"",right=line.cells[1]?.trim()??"";
  return !!left&&!AMOUNT.test(left)&&AMOUNT.test(right);
}
/** A cap opener in the name's column: at the end of the cell ("Ears, up to"), or at its start with a number after it
 * ("Maximum 30 days per year"). A name such as "Maximum lifetime limit" is a row of its own. */
const CAP_LEFT_END=/(?:^|[\s,;:])(?:up to|max(?:imum)?(?: of)?|limited to|not exceed(?:ing)?|capped at|subject to(?: a)?(?: maximum| limit)?(?: of)?)$/i;
const CAP_LEFT_START=/^(?:up to|max(?:imum)?|limited to|not exceed(?:ing)?|capped at)(?:\s+of)?\s+\d/i;
function withContinuation(label:string,lines:PageLine[],index:number,value=""){
  let text=label,valueSuffix="",valueLine:string|null=null,consumed:number|null=null;
  for(let next=index+1;next<lines.length&&next<=index+2;next++){
    const line=lines[next];
    // The amount stops mid-phrase and the line below prints the rest of it in the amount's column, even when that rest
    // reads as an amount on its own ("Hearing Loss in | 15% of the Sum Insured, up to" / "One Ear | £10,000").
    // Only when the line below cannot be a row of its own (TE pr234 D1): the name above stops mid-phrase or the left
    // cell runs on in lower case, and the right cell is only the rest of the amount, never a new amount ("S$200 per day").
    const left=line.cells[0]?.trim()??"",right=line.cells[1]?.trim()??"";
    const dangling=next===index+1&&VALUE_UNFINISHED.test(value.trim())&&line.cells.length===2&&AMOUNT.test(right)&&!AMOUNT.test(left)
      &&!/^(?:\(?[a-z0-9]{1,3}[.)]|\d)/i.test(left)&&(UNFINISHED.test(text)||/^[a-z]/.test(left))&&AMOUNT_REST.test(right)
      // A bare sum ("S$20,000") reads as a row of its own when another name | amount row follows it ("Both Ears |
      // S$20,000" / "One Ear | S$10,000" is a list under the name above, not the rest of its amount): left unjoined.
      // Only words that cannot start an amount ("of S$25,000") finish the amount above whatever follows (Critic H1).
      &&(/^[a-z]/.test(right)||!labelAmountRow(lines[next+1]));
    // A cap printed on the line below in the name's column belongs to the row above, never a benefit of its own with the
    // cap as its amount (TE #342: "Hearing loss in both | 50% of the Sum Insured" / "Ears, up to | RM 100,000";
    // "Hospital cash | RM 100 per day" / "Maximum 30 days per year | RM 3,000"): a left cell that ends in a cap opener,
    // or starts with one followed by a number, finishes the row above, its words before the opener finishing the name.
    if(next===index+1&&line.cells.length===2&&AMOUNT.test(right)&&!AMOUNT.test(left)){
      const ends=left.match(CAP_LEFT_END),starts=CAP_LEFT_START.test(left);
      if(ends||starts){
        const head=starts?"":left.slice(0,ends!.index).replace(/[,;:\s]+$/,"");
        if(head)text=text+" "+head;
        valueLine=line.text;consumed=next;valueSuffix=" "+(starts?left:ends![0].trim())+" "+right;
        break;
      }
    }
    // "15% of Sum Insured or" / "up to S$50,000, whichever is lesser": an amount that stops on "or" or "and" goes on in
    // the line below when that line is only the rest of it, one cell in lower case with an amount ("up to …", "or …").
    // Left apart, the row was stored as half a rule ("15% of Sum Insured or") and shown as not readable.
    const restOfChoice=next===index+1&&/\b(?:or|and)$/i.test(value.trim())&&line.cells.length===1&&/^[a-z]/.test(left)
      &&AMOUNT.test(left)&&left.length<=70;
    if(restOfChoice){valueLine=line.text;consumed=next;valueSuffix=" "+left.replace(/\s+/g," ");break;}
    if(line.cells.some(isValueCell)&&!dangling)break;
    const piece=line.cells.join(" ").replace(/\s+/g," ").trim();
    // "th" printed on a line of its own is the raised end of an ordinal in the row below ("from the 11<sup>th</sup> day"),
    // never part of a name: a name ending in it no longer matches its own quoted row.
    if(/^\p{L}{1,2}$/u.test(piece))break;
    if(!piece||piece.length>70||/^\d+[.)]/.test(piece))break;
    // "15% of Sum Insured or" / "up to S$50,000, whichever is lesser": the
    // second line finishes the AMOUNT, not the name. Reading it as part of the
    // name would leave a half-stated rule looking complete.
    // The line is printed with the rest of the row, so it is quoted with it: half a rule quoted is a wrong rule.
    // In a two-column row both cells wrap ("Angioplasty … for | … up to maximum" / "Coronary Artery | of S$25,000"):
    // the left cell finishes the name and the right one the amount, never one run into the other.
    if(AMOUNT.test(piece)||/whichever/i.test(piece)){
      valueLine=line.text;consumed=next;
      const cells=line.cells.map(cell=>cell.replace(/\s+/g," ").trim()).filter(Boolean);
      if(cells.length===2&&UNFINISHED.test(text)&&!AMOUNT.test(cells[0])&&text.length+cells[0].length+1<=140){text=text+" "+cells[0];valueSuffix=" "+cells[1];}
      else valueSuffix=" "+piece;
      break;
    }
    // Either this line opened mid-phrase, or the next one starts mid-phrase.
    // A short or code-like label is never extended by the line below it: on a
    // two-column page that line belongs to the other column.
    if(!UNFINISHED.test(text)&&text.length<8)break;
    if(!UNFINISHED.test(text)&&!/^[a-z]/.test(piece)&&!/\)$/.test(piece))break;
    // "Terminal age | Seventy (70)" under a finished name is a row of its own (a name and its own cell), never the rest
    // of the name above.
    if(!UNFINISHED.test(text)&&line.cells.length>=2&&/^\p{Lu}/u.test(line.cells[0]))break;
    if(text.length+piece.length+1>140)break;
    text=text+" "+piece;
  }
  return {label:text,valueSuffix,valueLine,consumed};
}
/** Some tables of percentages are not benefit schedules at all. A pro-ration
 * factor says how a bill is scaled before a claim is computed; "Class B1 34%"
 * is not cover and must never appear as cover. */
const NOT_A_BENEFIT_TABLE=/pro-?ration factor|premium rate|schedule of premiums|premium table/i;
const NEW_TABLE=/^table\s+[a-z][:.]/i;
/** A premium table ends only on a positive signal (Coordinator and Critic #347): a line that is a recognised
 * benefit-schedule heading and nothing else -- "Disability Benefit Schedule", "Schedule of Benefits", "Table of
 * Benefits", "Summary of Benefits", "Benefits Table". A cover name ("• Hospital Cover", "• Critical Illness Benefit",
 * "▪ Basic Benefits") is not one: premium tables are grouped under cover names. The heading must name a schedule,
 * table or summary of benefits, carry no figure and no premium, rate, charge, cost, rider or guarantee word. And the
 * first row under it must not be an age or band row ("Age 30 to 39", "Under 26", "26 to 30"), which is a premium
 * row whatever the heading says. Anything else stays in the premium table and fails closed. */
const BULLET=/^[\u2022\u25aa\u25cf\u25e6\u2023\u2043]\s*/u;
const SCHEDULE_HEADING=/^(?:[a-z&'’\/-]+\s+){0,4}(?:benefits?\s+(?:schedule|table|summary)|(?:schedule|table|summary)\s+of\s+benefits)$/i;
const BAND_ROW=/^(?:(?:age|ages|aged|anb|alb|age next birthday|band|class|tier)\b|under\s+\d|below\s+\d|up to age\b|\d{1,3}\s*(?:to|-|–|and)\s*\d{1,3}\b|\d{1,3}\s*(?:and|or)\s+(?:above|over|below|under)\b)/i;
function startsBenefitSchedule(line:PageLine){
  const cells=line.cells.map(cell=>cell.replace(BULLET,"").trim()).filter(Boolean);
  if(cells.length!==1)return false;
  const heading=cells[0].replace(/[:.]$/,"").replace(/\s+/g," ").trim();
  if(!heading||heading.length>60||/\d/.test(heading))return false;
  if(/\b(?:premiums?|rates?|charges?|costs?|prices?|fees?|loadings?|discounts?|riders?|guaranteed|payable by|you pay)\b/i.test(heading))return false;
  return SCHEDULE_HEADING.test(heading);
}
/** The first line after `from` that carries a value: an age or band row means the premium table goes on. */
function firstValueRowIsBand(lines:PageLine[],from:number){
  for(let i=from+1;i<lines.length;i++){
    const line=lines[i];
    if(line.cells.length<2||!line.cells.some(isValueCell))continue;
    return BAND_ROW.test(line.cells[0].replace(BULLET,"").trim());
  }
  return false;
}
/** A band in a burns table -- "Equals to or greater than 10% but less than 15%".
 * The percentage in the row is a percentage of the BODY; the percentage beside
 * it is the payout. Read on its own the row means nothing, which is why the
 * label above it has to be carried down. */
const BURN_BAND=/\bequals? to or greater than\b/i;
/** "Third Degree Burns", "Second Degree Burns": a heading with no amount that
 * changes what every band under it pays. Deliberately narrow -- a page is full
 * of lines with no amount ("Area", "Compensation", "(% of Sum Insured)"), and
 * only this one decides a payout. */
const BURN_SECTION=/^(?:first|second|third|1st|2nd|3rd)[\s-]+degree\s+burns?$/i;
// ---------------------------------------------------------------------------
// Column-aware tables
// ---------------------------------------------------------------------------
/** A column that numbers rows ("Section", "Item", "No."), never a label. */
const ROW_NUMBER_HEADING=/^(?:section|item|no\.?|s\/?n|#|clause|ref\.?)$/i;
/** A column of footnote references, never a value. */
const NOTES_HEADING=/^(?:notes?|remarks?|footnotes?)$/i;
/** Cells a benefit table prints instead of an amount. */
const WORDED_VALUE=/^(?:as\s+charged|not\s+covered|not\s+applicable|unlimited|covered\s+in\s+full|no\s+cap|nil|n\/?a|included|extended\b)/i;
function valueLike(cell:string){return isValueCell(cell)||WORDED_VALUE.test(cell.trim())||/^(?:up to|you pay|co-?payment|reimbursed|per scale)\b/i.test(cell.trim())||AMOUNT.test(cell);}
/** Payments the household makes, printed in schedules and notices. Never a
 * benefit, in a table or out of one. */
const PAYMENT_LABEL=/\b(?:medisave|cash\s+payable|payable\s+(?:in|by|from|with)\s+(?:cash|medisave|cpf|giro|card)|amount\s+(?:due|payable)|total\s+(?:cash\s+)?(?:payable|due)|payment\s+(?:due|mode|date)|giro|premium\s+payable)\b|^\s*less\s*:/i;
const REPLACED_COLUMN=/^(?:before|old|previous|original|existing|current|from)(?:\s+(?:amount|value|sum assured|cover|premium))?$/i;
const AMENDED_COLUMN=/^(?:after|new|revised|amended|altered|updated|to)(?:\s+(?:amount|value|sum assured|cover|premium))?$/i;
const COST_SHARING_LABEL=/\b(?:deductibles?|co-?insurance|co-?pay(?:ment)?(?:\s+cap)?|pro-?ration(?: factor)?)\b/i;
const TWO_COLUMN_LABEL=/^(?:benefits?|items?|features?|description|cover(?:age)?|particulars|benefit\s*\(.*\))$/i;
const TWO_COLUMN_VALUE=/^(?:limits?|amounts?|benefits?|sum (?:insured|assured)|values?|details?|coverage|maximum(?: limit)?|limit of liability|what we pay)$/i;
/** Headings of a column of benefit NAMES. A person's name, a plan, a tier or a value heading never is one. */
const LABEL_HEADING=/^(?:(?:type\s+of\s+)?benefits?(?:\s+(?:type|name|description|details))?|(?:schedule|table|summary)\s+of\s+benefits|items?|features?|descriptions?|cover(?:age)?(?:\s+type)?|type\s+of\s+cover(?:age)?|particulars|benefit\s*\(.*\))$/i;
type TableShape={header:string[];labelCol:number;rowNumberCol:number;valueCols:number[];from:number;to:number};
/** Finds tables: a heading line of three or more cells with no amount in it,
 * followed by rows with the same number of column slots, at least one of
 * which prints a value. */
function findTables(lines:PageLine[]):TableShape[]{
  const tables:TableShape[]=[];
  for(let i=0;i<lines.length;i++){
    const head=lines[i].rawCells??lines[i].cells;
    // Round 7: a two-column schedule says so in its heading ("Benefit | Limit",
    // "Feature | Benefit"); its "As charged", "120 days" and cost-sharing
    // rows are table rows like any other, not prose to skip.
    const twoColumn=head.length===2&&TWO_COLUMN_LABEL.test(head[0]??"")&&TWO_COLUMN_VALUE.test(head[1]??"");
    if(!twoColumn&&(head.length<3||head.filter(Boolean).length<3))continue;
    if(head.slice(1).some(cell=>cell&&valueLike(cell)))continue;
    let j=i+1;
    while(j<lines.length){
      const cells=lines[j].rawCells??lines[j].cells;
      if(cells.length<2||cells.length>head.length)break;
      if(cells.filter(Boolean).length<2)break;
      j++;
    }
    if(j-i<2)continue;
    const body=lines.slice(i+1,j).map(line=>line.rawCells??line.cells);
    // A table prints a value on most (over half) of its rows. Prose laid out in columns
    // beside a small table ("Monthly payouts | Year that new | Fixed monthly
    // payout" over wrapped sentences, then "2026 | $689") is not one: it is
    // left to the line reader, which reads the year/amount rows as printed.
    const valued=body.filter(cells=>cells.slice(1).some(cell=>cell&&valueLike(cell))).length;
    if(!valued||valued*2<=body.length)continue;
    let rowNumberCol=head.findIndex(cell=>ROW_NUMBER_HEADING.test(cell.replace(/\s+/g,"")));
    // A heading such as "Item" over words ("Death sum assured") heads the
    // label column, not a column of row numbers.
    if(rowNumberCol>=0&&!body.every(cells=>!cells[rowNumberCol]||/^\(?\d{1,2}[a-z]?[.)]?$|^\(?[a-z][.)]$/i.test(cells[rowNumberCol]??"")))rowNumberCol=-1;
    if(rowNumberCol<0&&body.every(cells=>!cells[0]||/^\d{1,2}[a-z]?[.)]?$/i.test(cells[0])))rowNumberCol=0;
    const labelCol=rowNumberCol===0?1:0;
    let valueCols=head.map((_,col)=>col).filter(col=>col!==labelCol&&col!==rowNumberCol&&!NOTES_HEADING.test(head[col].trim()));
    // Round 7: an endorsement's "Item | Before | After" table states what the
    // policy says NOW in its "after" column; the "before" column is the
    // replaced figure, not a second plan tier.
    const after=valueCols.find(col=>AMENDED_COLUMN.test(head[col].trim()));
    if(after!=null&&valueCols.some(col=>REPLACED_COLUMN.test(head[col].trim())))valueCols=[after];
    if(!valueCols.length)continue;
    tables.push({header:head,labelCol,rowNumberCol,valueCols,from:i,to:j});
    i=j-1;
  }
  return tables;
}
function tableRows(lines:PageLine[],table:TableShape):BenefitRow[]{
  const rows:BenefitRow[]=[];
  for(let index=table.from+1;index<table.to;index++){
    const cells=lines[index].rawCells??lines[index].cells;
    let labelCol=table.labelCol;
    const namesColumn=(col:number)=>LABEL_HEADING.test((table.header[col]??"").replace(/\s+/g," ").trim());
    // The row's own name, when the label column does not hold it: its first worded cell after the label cell (or, with
    // the label cell empty, its first worded cell at all), when that comes before any value and its column is headed as
    // benefit names. This covers a sideways table ("Overall limit | Benefit | Own limit": a shared amount or a group
    // name in column 0) without ever moving a name under "Jane Doe | John Roe" or a plan (Critic #410 F6) or naming a
    // row by a condition under "Detail" (TE #410 T5); such a row keeps its label cell, or is skipped when that is empty
    // (TE #410 T4: "\tChiropractic\tS$75" had lost its own S$75).
    let moved=false;
    if(!namesColumn(labelCol)){
      const next=cells.findIndex((cell,col)=>col>labelCol&&col!==table.rowNumberCol&&!!cell.trim());
      const emptyLabel=!(cells[labelCol]??"").trim();
      // A cell that starts in lower case or with a footnote mark ("per visit", "* per policy year") continues the row
      // above; it is never a benefit's name (Critic #410 F7), so such a row is skipped as on main.
      if(next>=0&&namesColumn(next)&&!valueLike(cells[next])&&!/^\s*[a-z*]/.test(cells[next])&&(emptyLabel||cells.slice(labelCol+1,next).every((c)=>!c.trim()))){labelCol=next;moved=true;}
    }
    const label=(cells[labelCol]??"").replace(/\s+/g," ").trim();
    if(label.length<2||label.length>160)continue;
    if(PAYMENT_LABEL.test(label)||(PREMIUM_LABEL.test(label)&&!PREMIUM_BENEFIT.test(label)))continue;
    if(NOT_A_BENEFIT_LABEL.some(pattern=>pattern.test(label)))continue;
    for(const col of moved?[table.labelCol,...table.valueCols]:table.valueCols){
      if(col===labelCol)continue;
      const value=(cells[col]??"").replace(/\s+/g," ").trim();
      // The cell the name moved from is kept only as a value it really is (a shared "S$5,000 overall"), never as a
      // group name read as a value.
      if(moved&&col===table.labelCol&&!valueLike(value))continue;
      // Round 10: a dash is how a table prints an empty cell, never a value.
      if(!value||/^[-–—]$/.test(value))continue;
      rows.push({label,value,line:lines[index].text,index,
        tier:table.valueCols.length>1?(table.header[col]??"").replace(/\s+/g," ").trim()||null:null,fromTable:true});
    }
  }
  return rows;
}

export function benefitRows(lines:PageLine[]):BenefitRow[]{
  const rows:BenefitRow[]=[];
  // Tables with a heading row are read by column, so each value keeps the
  // column it was printed under; their lines are not read again below.
  const tables=findTables(lines);
  const inTable=new Set<number>();
  // A table under a pro-ration factor or premium heading is not a benefit
  // schedule, read by column or not (see NOT_A_BENEFIT_TABLE).
  const underExcludedHeading=(from:number)=>{
    for(let i=from;i>=0;i--){
      const whole=lines[i].text.replace(/\s+/g," ").trim();
      if(NOT_A_BENEFIT_TABLE.test(whole))return true;
      if(i<from&&(NEW_TABLE.test(whole)||tables.some(table=>i>table.from&&i<table.to)))return false;
    }
    return false;
  };
  for(const table of tables){
    for(let i=table.from;i<table.to;i++)inTable.add(i);
    // Round 7 (port): in a two-column schedule a row that says the cover is not there ("Outpatient: Not included
    // in this plan") is a line about what is excluded, not a benefit.
    const twoColumn=table.header.length===2;
    if(!underExcludedHeading(table.from))rows.push(...tableRows(lines,table).filter(row=>!(twoColumn&&/^(?:not (?:included|covered|applicable|available)|excluded|nil|none)\b/i.test(row.value.trim()))));
  }
  let stem:string|null=null,suppressed=false;
  // A two-column table states "Head" once and leaves the rows beneath it to
  // continue with a bare dash. Those rows were stored as "- Equals to or
  // greater than 5% but less than 8%", which belongs to no part of the body and
  // to neither burns table, so nothing downstream could tell them apart.
  let area:string|null=null,section:string|null=null;
  // A line that finished the amount of the row above it is part of that row, never a row of its own.
  const consumedLines=new Set<number>();
  for(const [index,line] of lines.entries()){
    if(inTable.has(index)||consumedLines.has(index))continue;
    const whole=line.text.replace(/\s+/g," ").trim();
    if(NOT_A_BENEFIT_TABLE.test(whole))suppressed=true;
    // A premium table ends where the next table or the next bulleted section starts ("• Disability Benefit Schedule"):
    // left on to the foot of the page, it hid the benefit schedule printed under the premium rates.
    else if(suppressed&&(NEW_TABLE.test(whole)||(startsBenefitSchedule(line)&&!firstValueRowIsBand(lines,index))))suppressed=false;
    if(suppressed)continue;
    const valueIndex=line.cells.findIndex(isValueCell);
    if(valueIndex<0||line.cells.length<2){
      // "2. Permanent Total Loss of" carries no amount of its own but names the
      // rows under it, which would otherwise read as "(b) Whole eye".
      const heading=line.cells.join(" ").replace(/\s+/g," ").trim();
      if(BURN_SECTION.test(heading)){section=heading;area=null;}
      if(/^\d+[.)]\s+\S/.test(heading)&&heading.length<=90&&!AMOUNT.test(heading))stem=heading;
      continue;
    }
    if(valueIndex<1)continue;
    // A lone ":" printed between the name and its amount ("Treatment for : 10% of …") is not part of the name.
    const stated=line.cells.slice(0,valueIndex).filter(cell=>!/^[:：]$/u.test(cell.trim())).join(" ").replace(/\s+/g," ").trim();
    // Judge what the row itself says before anything is appended to it, so a
    // premium rate table's "50-54" cannot be rescued by the prose beside it.
    if(stated.length<2||stated.length>140||!namesABenefit(stated))continue;
    const continued=withContinuation(stated,lines,index,line.cells[valueIndex]);
    if(continued.consumed!=null)consumedLines.add(continued.consumed);
    let label=continued.label;
    if(label.length<2||label.length>140)continue;
    if(BURN_BAND.test(label)){
      // The row states its own area ("Head - ...") -- remember it for the rows
      // beneath, which state only a dash.
      const own=/^([A-Za-z][A-Za-z ]{1,14}?)\s*[-\u2013]\s*(?=equals? to)/i.exec(label);
      if(own)area=own[1].trim();
      else if(area)label=area+" - "+label.replace(/^[-\u2013]\s*/,"");
      if(section&&!label.toLowerCase().startsWith(section.toLowerCase()))label=section+" \u00b7 "+label;
      if(label.length>140)continue;
    }
    // A numbered row that itself carries "(a)" opens a group; the "(b)", "(c)"
    // rows beneath it inherit its wording so each one stands on its own.
    const opened=parentStem(label);
    if(opened)stem=opened;
    else if(stem&&SUB_ROW.test(label)&&!/^\d/.test(label))label=stem+" "+label;
    else if(/^\d+[.)]/.test(label))stem=null;
    if(label.length>140||!namesABenefit(label))continue;
    rows.push({label,value:(line.cells[valueIndex].trim()+continued.valueSuffix).trim(),line:continued.valueLine?wrappedLine(label,line.cells[valueIndex].trim()+continued.valueSuffix):line.text,index});
  }
  return rows.sort((a,b)=>a.index-b.index);
}

/** Round 7: cost-sharing lines printed outside a table ("Deductible per
 * policy year (A ward, age 80 and below)<TAB>S$3,500", "Co-insurance on
 * claimable amount above the deductible<TAB>10%"). They are never benefits
 * (benefitRows leaves them out); the catalog stores them as the schedule
 * terms they are, typed by their label, so "what is dad's deductible?" can
 * be answered from the page that prints it. */
export function costSharingRowsFromText(text:string):BenefitRow[]{
  const lines=linesFromStoredText(text);
  const inTable=new Set<number>();
  for(const table of findTables(lines))for(let i=table.from;i<table.to;i++)inTable.add(i);
  const rows:BenefitRow[]=[];
  for(const [index,line] of lines.entries()){
    if(inTable.has(index)||line.cells.length!==2)continue;
    const [label,value]=line.cells.map(c=>c.replace(/\s+/g," ").trim());
    if(!COST_SHARING_LABEL.test(label)||PAYMENT_LABEL.test(label)||label.length>140)continue;
    if(!(isValueCell(value)||/^\d{1,3}(?:\.\d+)?\s?%/.test(value)||WORDED_VALUE.test(value)))continue;
    rows.push({label,value,line:line.text,index,tier:null,fromTable:false});
  }
  return rows;
}

/** Rebuilds lines and cells from stored page text.
 *
 * Tabs and newlines are preserved when a page is saved, so a document already
 * in the database can be re-read as a table without re-opening the PDF. */
export function linesFromStoredText(text:string):PageLine[]{
  return (text??"").split("\n").map((line,index)=>{
    const rawCells=line.split("\t").map(cell=>cell.trim());
    const cells=rawCells.filter(Boolean);
    return {cells,rawCells,text:line,y:-index};
  }).filter(line=>line.cells.length>0);
}
export function benefitRowsFromText(text:string){return benefitRows(linesFromStoredText(text));}

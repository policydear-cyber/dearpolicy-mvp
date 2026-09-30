"use client";

import { FormEvent, useEffect, useState } from "react";
import { formatMoney } from "@/lib/format/currency";
import { customerError } from "@/components/customer-text";
import { uploadPolicyDocument } from "@/components/upload-document";

type Member = { id: string; display_name: string; relationship: string };
type RecordRow = { id: string; family_member_name: string | null; insurer: string | null; product_name: string | null; policy_number: string | null; amount: string; currency: string; frequency: string | null; payment_date: string | null; period_start: string | null; notes: string | null };

function money(amount: string, currency: string) { return formatMoney(amount,currency); }

export default function RecordsPage() {
  const [family,setFamily] = useState<Member[]>([]); const [records,setRecords] = useState<RecordRow[]>([]);
  const [memberId,setMemberId] = useState(""); const [file,setFile] = useState<File|null>(null); const [password,setPassword] = useState("");
  const [busy,setBusy] = useState(false); const [status,setStatus] = useState("");

  async function refresh() {
    const [f,r] = await Promise.all([fetch("/api/family").then((x)=>x.json()),fetch("/api/premiums").then((x)=>x.json())]);
    setFamily(f.family ?? []); setRecords(r.records ?? []);
  }
  useEffect(()=>{ void refresh(); },[]);

  async function upload(event: FormEvent) {
    event.preventDefault(); if(!file) return; setBusy(true); setStatus("Uploading…");
    try {
      await uploadPolicyDocument(file,{familyMemberId:memberId||null,pdfPassword:password,onProgress:(f)=>setStatus(`Uploading… ${Math.round(f*100)}%`)});
      setStatus("Uploaded. DearPolicy is reading it now — any payments it finds will appear below in a minute or two.");
      setFile(null); setPassword(""); await refresh();
      // The document is read in the background: check back a few times.
      for(const wait of [8000,20000,45000]) setTimeout(()=>{ void refresh(); },wait);
    } catch(e){ setStatus(customerError(e, "The upload did not go through. Please try again.")); } finally { setBusy(false); }
  }

  return (
    <div className="page">
      <header className="page-header compact"><div><div className="eyebrow">PREMIUM RECORDS</div><h1>Know what your family is paying.</h1><p className="lead">Upload renewal notices, premium receipts and annual statements. DearPolicy extracts actual payment amounts and uses the latest record to estimate current monthly and annual insurance cost.</p></div></header>
      <section className="upload-panel">
        <form onSubmit={upload} className="upload-form records-upload">
          <div className="field"><label htmlFor="rec-profile">Profile (optional)</label><select id="rec-profile" value={memberId} onChange={(e)=>setMemberId(e.target.value)}><option value="">Auto-detect from document</option>{family.map((m)=><option value={m.id} key={m.id}>{m.display_name}</option>)}</select></div>
          <div className="field"><label htmlFor="rec-file">Receipt / renewal PDF</label><input id="rec-file" type="file" accept="application/pdf,.pdf" onChange={(e)=>setFile(e.target.files?.[0]??null)} /></div>
          <div className="field"><label htmlFor="rec-password">PDF password (if required)</label><input id="rec-password" type="password" autoComplete="off" value={password} onChange={(e)=>setPassword(e.target.value)} placeholder="Leave blank if not required" /></div>
          <button className="button primary" type="submit" disabled={!file||busy}>{busy?"Uploading…":"Upload & extract"}</button>
        </form>
        {status && <div className="upload-status">{status}</div>}
        <div className="note">Upload PDF statements/receipts. Photo and email-receipt OCR can be added before public beta.</div>
      </section>
      <section className="section">
        <div className="section-heading"><div><div className="eyebrow">HISTORY</div><h2>Extracted premium records</h2></div></div>
        <div className="payment-list">
          {records.map((r)=><div className="payment-row" key={r.id}><div className="payment-brand">{(r.insurer??"IN").slice(0,2).toUpperCase()}</div><div className="payment-main"><strong>{r.product_name??r.insurer??"Insurance payment"}</strong><span>{r.family_member_name??"Shared / family payment"}{r.policy_number?` · ${r.policy_number}`:""}</span></div><div className="payment-amount"><strong>{money(r.amount,r.currency)}</strong><span>{r.frequency??r.payment_date??r.period_start??"payment record"}</span></div></div>)}
          {!records.length && <div className="empty-card">No premium records yet. Upload the latest receipt or renewal notice from an insurer.</div>}
        </div>
      </section>
    </div>
  );
}

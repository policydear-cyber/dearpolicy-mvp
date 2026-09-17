"use client";
import Link from "next/link";
import { useEffect,useState } from "react";

type Claim={id:string;family_member_id:string;display_name:string;relationship:string;status:string;event_type:string|null;event_summary:string|null;facts:Record<string,unknown>;decision_packet:Record<string,unknown>|null;created_at:string;updated_at:string};
export default function ClaimsPage(){
 const [claims,setClaims]=useState<Claim[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState("");
 useEffect(()=>{fetch("/api/claims").then(r=>r.json()).then(d=>{if(d.error)throw new Error(d.error);setClaims(d.claims??[])}).catch(e=>setError(e.message)).finally(()=>setLoading(false));},[]);
 return <div className="page"><header className="page-header"><div><div className="eyebrow">CLAIM CHECKS</div><h1>When something happens, pick up where you left off.</h1><p className="lead">DearPolicy keeps the facts you already gave for each event so you do not have to explain the same accident or diagnosis again.</p></div><Link href="/chat" className="button primary">Start a claim check</Link></header>
 {error&&<div className="alert error">{error}</div>}
 <section className="section"><div className="claims-list">{loading?<div className="empty-card">Loading claim checks…</div>:claims.length?claims.map(c=>{const factCount=Object.values(c.facts??{}).filter(v=>v!==null&&v!==""&&(!Array.isArray(v)||v.length)).length;return <div className="claim-session-entry" key={c.id}><Link className="claim-session-card" href={`/chat?member=${c.family_member_id}&claim=${c.id}`}><div className="claim-session-icon">!</div><div><strong>{c.event_summary??"Claim check"}</strong><span>{c.display_name} · {c.relationship}</span><small>{factCount} fact{factCount===1?"":"s"} saved · Updated {new Date(c.updated_at).toLocaleString()}</small></div><div className={`claim-session-status ${c.status}`}>{c.status==="complete"?"Assessment ready":"Fact finding"}</div><b>›</b></Link>{c.decision_packet?<a className="claim-pack-link" href={`/api/claims/${c.id}/pack`}>Download the claim pack (PDF) — who is claiming, under which policy, for how much, and what to attach</a>:null}</div>}):<div className="empty-card">No claim checks yet. When an accident, diagnosis or hospital admission happens, start with “What can I claim?”</div>}</div></section>
 </div>;
}

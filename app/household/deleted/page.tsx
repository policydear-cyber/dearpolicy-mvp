"use client";
import { useState } from "react";

/** Round 5 (item 2): where "Permanently delete household" lands. The
 * household and everything in it is gone, so every household page would
 * fail; this says what happened and offers the two real next steps. */
export default function HouseholdDeletedPage() {
  const [busy, setBusy] = useState<"" | "start" | "signout">("");
  const [error, setError] = useState("");
  async function startNew() {
    setBusy("start"); setError("");
    try {
      const response = await fetch("/api/household/start", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      if (!response.ok) throw new Error();
      window.location.assign("/family");
    } catch {
      setError("A new household could not be started just now. Please try again in a moment.");
      setBusy("");
    }
  }
  async function signOut() {
    setBusy("signout");
    try { await fetch("/api/auth/signout", { method: "POST" }); } catch { /* leave anyway */ }
    window.location.assign("/login");
  }
  return (
    <div className="page" style={{ maxWidth: 560, paddingTop: 72 }} data-testid="household-deleted">
      <h1>Your household has been deleted.</h1>
      <p className="lead">Its family profiles, documents, claims and chats have been removed, and DearPolicy no longer uses any of them. Your sign-in still works.</p>
      <div className="hero-actions" style={{ marginTop: 20 }}>
        <button type="button" className="button primary" disabled={!!busy} onClick={() => void startNew()}>{busy === "start" ? "Starting…" : "Start a new household"}</button>
        <button type="button" className="button secondary" disabled={!!busy} onClick={() => void signOut()}>{busy === "signout" ? "Signing out…" : "Sign out"}</button>
      </div>
      {error && <div className="alert error" role="alert" style={{ marginTop: 16 }}>{error}</div>}
      <p className="muted" style={{ marginTop: 16 }}>A new household starts empty: you add your family and upload documents again.</p>
    </div>
  );
}

"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { customerMessage } from "@/components/customer-text";

function InviteForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [token, setToken] = useState(params.get("token") ?? "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/household/invitations/accept", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: token.trim() }),
      });
      const payload = await response.json().catch(() => ({}));
      if (response.status === 401) {
        router.push(`/login?next=${encodeURIComponent(`/invite?token=${token.trim()}`)}`);
        return;
      }
      if (!response.ok) {
        setError(customerMessage(payload.error, "We couldn't accept this invitation. It may have expired or already been used. Ask the person who invited you for a new link."));
        return;
      }
      router.push("/household");
      router.refresh();
    } catch {
      setError("We couldn't accept this invitation. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <header className="page-header compact">
        <div>
          <div className="eyebrow">INVITATION</div>
          <h1>Join a household</h1>
          <p className="lead">Press Join household below. If the box is empty, paste the code from the end of your invitation link (the part after &ldquo;token=&rdquo;).</p>
        </div>
      </header>
      <section className="section">
        <form onSubmit={submit} className="profile-add-grid">
          <div className="field"><label htmlFor="invite-code">Invitation code</label><input id="invite-code" value={token} onChange={(e) => setToken(e.target.value)} placeholder="Paste the code from your invitation link" required /></div>
          <button className="button primary" type="submit" disabled={!token.trim() || busy}>{busy ? "Joining…" : "Join household"}</button>
        </form>
        {error && <div className="document-warning" style={{ marginTop: 12 }}>{error}</div>}
      </section>
    </div>
  );
}

export default function InvitePage() {
  return (
    <Suspense fallback={<div className="page"><p className="lead">Loading…</p></div>}>
      <InviteForm />
    </Suspense>
  );
}

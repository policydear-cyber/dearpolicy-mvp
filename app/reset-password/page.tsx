"use client";
import { useState } from "react";
import Link from "next/link";

export default function ResetPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });
    } finally {
      setBusy(false);
      // Always shown, whether or not the email matched an account -- see
      // app/api/auth/reset-password/route.ts for why.
      setSent(true);
    }
  };

  return (
    <div className="page" style={{ maxWidth: 420, paddingTop: 96 }}>
      <h1>Reset your password</h1>
      {sent ? (
        <p className="lead">If that email has an account, a reset link has been sent. It expires soon, so use it promptly.</p>
      ) : (
        <form onSubmit={submit} className="field">
          <label htmlFor="rp-email">Email</label>
          <input id="rp-email" type="email" autoComplete="email" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
          <button className="button primary" type="submit" disabled={busy || !email.trim()} style={{ marginTop: 10 }}>
            {busy ? "Sending…" : "Send reset link"}
          </button>
        </form>
      )}
      <p style={{ marginTop: 16 }}>
        <Link href="/login">Back to sign in</Link>
      </p>
    </div>
  );
}

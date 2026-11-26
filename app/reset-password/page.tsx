"use client";
import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

/** Why a reset link sent the person back here (app/api/auth/callback). */
const LINK_ERRORS: Record<string, string> = {
  expired: "That reset link has expired or has already been used. Send yourself a new one below.",
  other_browser: "That reset link opened in a different browser from the one you asked in, so it could not sign you in. Send yourself a new link below and open it in the same browser.",
};

/** When the request itself did not go through, so no link was sent. */
const SEND_PROBLEMS = {
  tooMany: "You have asked for several reset links in a row, so we have paused new ones for now. Please wait a while, then try again.",
  failed: "We could not send the link just now, so nothing has been sent. Check your connection and try again.",
};

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordForm />
    </Suspense>
  );
}

function ResetPasswordForm() {
  const linkError = useSearchParams().get("error");
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setProblem(null);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });
      // A refusal is the same for every email (the limit is per connection, a failure is ours), so telling the person
      // reveals nothing about accounts. A success is always shown the same way, whether or not the email matched an
      // account -- see app/api/auth/reset-password/route.ts for why.
      if (res.ok) setSent(true);
      else setProblem(res.status === 429 ? SEND_PROBLEMS.tooMany : SEND_PROBLEMS.failed);
    } catch {
      setProblem(SEND_PROBLEMS.failed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page" style={{ maxWidth: 420, paddingTop: 96 }}>
      <h1>Reset your password</h1>
      {!sent && linkError && LINK_ERRORS[linkError] ? (
        <div className="alert error" role="alert">
          {LINK_ERRORS[linkError]}
        </div>
      ) : null}
      {!sent && problem ? (
        <div className="alert error" role="alert">
          {problem}
        </div>
      ) : null}
      {sent ? (
        <p className="lead">If there is an account for that email, we have sent it a link to reset your password. The link expires soon, so use it today.</p>
      ) : (
        <>
        <p className="lead">Enter the email you signed up with. If it has an account, we will send a link to choose a new password. Open that link in this same browser.</p>
        <form onSubmit={submit} className="field">
          <label htmlFor="rp-email">Email</label>
          <input id="rp-email" type="email" autoComplete="email" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
          <button className="button primary" type="submit" disabled={busy || !email.trim()} style={{ marginTop: 10 }}>
            {busy ? "Sending…" : "Send reset link"}
          </button>
        </form>
        </>
      )}
      <p className="auth-links" style={{ marginTop: 16 }}>
        <Link href="/login">Back to sign in</Link>
      </p>
    </div>
  );
}

"use client";
import { useState } from "react";
import Link from "next/link";
import { customerMessage } from "@/components/customer-text";

/** Shown above the form while sign-up is invite-only (DEARPOLICY_SIGNUP_MODE=invite, read by app/signup/page.tsx). */
export const INVITE_ONLY_NOTE = "DearPolicy is open by invitation only at the moment. Use the email address your invitation was sent to.";

/** Form fields carry suppressHydrationWarning: browser extensions and
 * automation (password managers, the exploratory harness) add attributes
 * such as an inline caret-color to inputs before React hydrates, which
 * React otherwise reports as a hydration mismatch on this page. Only these
 * attribute differences are silenced; the markup itself is identical. */
export default function SignupForm({ inviteOnly = false, footer = null }: { inviteOnly?: boolean; footer?: React.ReactNode }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [householdName, setHouseholdName] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  // The button stays disabled until the form can be sent; these lines say
  // why, instead of leaving a greyed-out button with no reason.
  const [emailTouched, setEmailTouched] = useState(false);
  const emailLooksWrong = emailTouched && !!email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password, householdName }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(customerMessage(data.error, "Could not create your account."));
        return;
      }
      if (data.needsEmailConfirmation) {
        setNotice("Check your email for a confirmation link to finish creating your household.");
        return;
      }
      // One full-page navigation (as on sign-in): the app loads with the new session.
      window.location.assign("/");
    } catch {
      setError("Could not create your account. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page" style={{ maxWidth: 420, paddingTop: 96 }}>
      <h1>Create your household</h1>
      <p className="lead">Upload your family&apos;s insurance policies. DearPolicy shows what each person is covered for and answers your questions, with the page each answer comes from.</p>
      {/* Said before the form, so an invited person uses the right address and anyone else knows before typing a password. */}
      {inviteOnly ? <p className="alert" role="note" data-testid="signup-invite-only">{INVITE_ONLY_NOTE}</p> : null}
      <form onSubmit={submit} className="field">
        <label htmlFor="su-household">Household name (optional)</label>
        <input id="su-household" suppressHydrationWarning type="text" value={householdName} onChange={(e) => setHouseholdName(e.target.value)} />
        <label htmlFor="su-email" style={{ marginTop: 12 }}>
          Email
        </label>
        <input id="su-email" suppressHydrationWarning type="email" autoComplete="email" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} onBlur={() => setEmailTouched(true)} aria-invalid={emailLooksWrong || undefined} aria-describedby="su-email-hint" />
        <p id="su-email-hint" className={`field-hint${emailLooksWrong ? " invalid" : ""}`} aria-live="polite">{emailLooksWrong ? "That doesn’t look like an email address." : ""}</p>
        <label htmlFor="su-password" style={{ marginTop: 12 }}>
          Password
        </label>
        <input
          id="su-password" suppressHydrationWarning
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          aria-describedby="su-password-hint"
        />
        <p id="su-password-hint" className={`field-hint${password && password.length < 8 ? " invalid" : ""}`} aria-live="polite">{password && password.length < 8 ? `At least 8 characters (${8 - password.length} more).` : "At least 8 characters."}</p>
        {error ? (
          <div className="alert error" role="alert">
            {error}
          </div>
        ) : null}
        {notice ? (
          <div className="alert" role="status">
            {notice}
          </div>
        ) : null}
        <button className="button primary" type="submit" disabled={busy || !email.trim() || password.length < 8} style={{ marginTop: 10 }} aria-describedby="su-ready-hint">
          {busy ? "Creating…" : "Create household"}
        </button>
        {!busy && (!email.trim() || password.length < 8) ? <p id="su-ready-hint" className="field-hint">Enter your email and a password of at least 8 characters to continue.</p> : null}
      </form>
      <p style={{ marginTop: 16 }}>
        Already have an account? <Link href="/login">Sign in</Link>
      </p>
      {footer}
    </div>
  );
}

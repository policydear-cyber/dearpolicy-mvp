"use client";
import { Suspense, useState } from "react";
import Link from "next/link";
import { PRIVACY_NOTICE_FINAL } from "@/lib/privacy/notice-status";
import { useSearchParams } from "next/navigation";
import { customerMessage } from "@/components/customer-text";

const LINK_ERRORS: Record<string, string> = {
  missing_code: "That link is incomplete. Please ask for a new one.",
  invalid_or_expired_link: "That link has expired or has already been used. Please ask for a new one.",
  invalid_credentials: "Incorrect email or password.",
  missing_credentials: "Enter your email and password.",
  confirm_email: "Check your email. We sent you a link to confirm your address. Opening it signs you in.",
  invite_only: "DearPolicy is open by invitation only at the moment. If you were invited, use the email address the invitation was sent to.",
};

/**
 * Sign-in.
 *
 * V1.1 defect "the login button sometimes required two clicks". Root cause:
 * the button was disabled until React state held an email and a password,
 * and that state only changed on typed input. When the browser or a
 * password manager fills the fields, the values are on screen but no input
 * event reaches the page until the person first interacts with it -- so the
 * first click landed on a disabled button (doing nothing but "waking up" the
 * autofill), and only the second click signed in. The same happened when
 * someone typed before the page's scripts had loaded. A second, smaller
 * cause: after a successful sign-in the page did router.push() and then
 * router.refresh(), two navigations racing each other, which could leave
 * the person on this page with a session they could not see.
 *
 * Fix: the fields are read from the form itself at the moment of submitting
 * (whatever is on screen is what is sent); the button is disabled only while
 * a sign-in is actually in flight; after success the browser loads the
 * destination once, as a full page, so every part of the app starts from the
 * new session. The form also posts natively (method=post, never GET) so a
 * submit before scripts load can never put a password in the address bar.
 */
function LoginForm() {
  const params = useSearchParams();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const linkError = params.get("error");

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (busy) return;
    const form = new FormData(e.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");
    if (!email || !password) {
      setError("Enter your email and password.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth/signin", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(customerMessage(data.error, "Could not sign in. Please try again."));
        setBusy(false);
        return;
      }
      // One navigation, as a full page load: the destination is rendered
      // with the new session cookie from its first byte. Busy stays on until
      // the browser leaves, so there is nothing to click twice.
      window.location.assign(sameSitePath(params.get("next")) ?? sameSitePath(data.destination) ?? "/");
    } catch {
      setError("Could not sign in. Please check your connection and try again.");
      setBusy(false);
    }
  };

  return (
    <div className="page" style={{ maxWidth: 420, paddingTop: 96 }}>
      <h1>Welcome back</h1>
      <p className="lead">Sign in to see your family&rsquo;s policies and ask about them.</p>
      {linkError && LINK_ERRORS[linkError] ? (
        <div className="alert error" role="alert">
          {LINK_ERRORS[linkError]}
        </div>
      ) : null}
      <form onSubmit={submit} className="field" method="post" action="/api/auth/signin" noValidate>
        <input type="hidden" name="next" value={sameSitePath(params.get("next")) ?? ""} />
        <label htmlFor="dp-email">Email</label>
        <input id="dp-email" suppressHydrationWarning name="email" type="email" autoComplete="email" autoFocus required />
        <label htmlFor="dp-password" style={{ marginTop: 12 }}>
          Password
        </label>
        <div className="password-field">
          <input id="dp-password" suppressHydrationWarning name="password" type={showPassword ? "text" : "password"} autoComplete="current-password" required />
          <button type="button" className="mini-button" aria-pressed={showPassword} aria-controls="dp-password" onClick={() => setShowPassword((v) => !v)}>{showPassword ? "Hide" : "Show"}</button>
        </div>
        {error ? (
          <div className="alert error" role="alert">
            {error}
          </div>
        ) : null}
        <button className="button primary" type="submit" disabled={busy} aria-busy={busy} style={{ marginTop: 10 }}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
      <p style={{ marginTop: 16 }}>
        <Link href="/reset-password">Forgot your password?</Link>
      </p>
      <p>
        New here? <Link href="/signup">Create an account</Link>
      </p>
      {PRIVACY_NOTICE_FINAL ? (
        <p className="field-hint">
          <Link href="/privacy">How we handle your information</Link>
        </p>
      ) : null}
    </div>
  );
}

/** Only ever navigate within this app after sign-in: `next` comes from the
 * query string and could otherwise point anywhere. */
function sameSitePath(value: unknown): string | null {
  return typeof value === "string" && value.startsWith("/") && !value.startsWith("//") && !value.startsWith("/\\") ? value : null;
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}

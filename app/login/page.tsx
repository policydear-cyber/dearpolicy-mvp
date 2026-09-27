"use client";
import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

const LINK_ERRORS: Record<string, string> = {
  missing_code: "That link is missing its confirmation code. Please request a new one.",
  invalid_or_expired_link: "That link is invalid or has expired. Please request a new one.",
};

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const linkError = params.get("error");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
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
        setError(data.error || "Could not sign in.");
        return;
      }
      router.push(sameSitePath(params.get("next")) ?? sameSitePath(data.destination) ?? "/");
      router.refresh();
    } catch {
      setError("Could not sign in. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page" style={{ maxWidth: 420, paddingTop: 96 }}>
      <h1>DearPolicy</h1>
      <p className="lead">Sign in to your household.</p>
      {linkError && LINK_ERRORS[linkError] ? (
        <div className="alert error" role="alert">
          {LINK_ERRORS[linkError]}
        </div>
      ) : null}
      <form onSubmit={submit} className="field">
        <label htmlFor="dp-email">Email</label>
        <input id="dp-email" type="email" autoComplete="email" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
        <label htmlFor="dp-password" style={{ marginTop: 12 }}>
          Password
        </label>
        <input
          id="dp-password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error ? (
          <div className="alert error" role="alert">
            {error}
          </div>
        ) : null}
        <button className="button primary" type="submit" disabled={busy || !email.trim() || !password} style={{ marginTop: 10 }}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
      <p style={{ marginTop: 16 }}>
        <Link href="/reset-password">Forgot your password?</Link>
      </p>
      <p>
        New here? <Link href="/signup">Create a household</Link>
      </p>
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

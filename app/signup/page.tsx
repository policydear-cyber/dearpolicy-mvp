"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

export default function SignupPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [householdName, setHouseholdName] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

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
        setError(data.error || "Could not create your account.");
        return;
      }
      if (data.needsEmailConfirmation) {
        setNotice("Check your email for a confirmation link to finish creating your household.");
        return;
      }
      router.push("/");
      router.refresh();
    } catch {
      setError("Could not create your account. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page" style={{ maxWidth: 420, paddingTop: 96 }}>
      <h1>Create your household</h1>
      <p className="lead">DearPolicy keeps every family member&apos;s coverage in one place.</p>
      <form onSubmit={submit} className="field">
        <label htmlFor="su-household">Household name (optional)</label>
        <input id="su-household" type="text" value={householdName} onChange={(e) => setHouseholdName(e.target.value)} />
        <label htmlFor="su-email" style={{ marginTop: 12 }}>
          Email
        </label>
        <input id="su-email" type="email" autoComplete="email" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
        <label htmlFor="su-password" style={{ marginTop: 12 }}>
          Password
        </label>
        <input
          id="su-password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <p style={{ fontSize: 13, opacity: 0.75, marginTop: 4 }}>At least 8 characters.</p>
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
        <button className="button primary" type="submit" disabled={busy || !email.trim() || password.length < 8} style={{ marginTop: 10 }}>
          {busy ? "Creating…" : "Create household"}
        </button>
      </form>
      <p style={{ marginTop: 16 }}>
        Already have an account? <Link href="/login">Sign in</Link>
      </p>
    </div>
  );
}

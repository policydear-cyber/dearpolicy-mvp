"use client";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password }) });
      if (!response.ok) { setError("Incorrect password. Try again."); return; }
      router.push(params.get("next") || "/");
      router.refresh();
    } catch { setError("Could not sign in. Please try again."); }
    finally { setBusy(false); }
  };
  return (
    <div className="page" style={{ maxWidth: 420, paddingTop: 96 }}>
      <h1>DearPolicy</h1>
      <p className="lead">Enter the family password to continue.</p>
      <form onSubmit={submit} className="field">
        <label htmlFor="dp-password">Password</label>
        <input id="dp-password" type="password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
        {error ? <div className="alert error" role="alert">{error}</div> : null}
        <button className="button primary" type="submit" disabled={busy || !password.trim()} style={{ marginTop: 10 }}>{busy ? "Checking…" : "Continue"}</button>
      </form>
    </div>
  );
}

export default function LoginPage() {
  return <Suspense fallback={null}><LoginForm /></Suspense>;
}

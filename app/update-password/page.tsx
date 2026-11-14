"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { customerMessage } from "@/components/customer-text";
import { safeInviteNext } from "@/lib/auth/invite-return";

export default function UpdatePasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth/update-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(customerMessage(data.error, "We couldn't change your password. The link may have expired. Ask for a new one from “Forgot your password?” on the sign-in page."));
        return;
      }
      // An invited person setting their first password goes on to join (lib/auth/invite-return.ts); anyone else, home.
      let next: string | null = null;
      try { next = safeInviteNext(new URLSearchParams(window.location.search).get("next")); } catch { /* home */ }
      router.push(next ?? "/");
      router.refresh();
    } catch {
      setError("We couldn't change your password. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page" style={{ maxWidth: 420, paddingTop: 96 }}>
      <h1>Set a new password</h1>
      <form onSubmit={submit} className="field">
        <label htmlFor="up-password">New password</label>
        <input
          id="up-password"
          type="password"
          autoComplete="new-password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <p style={{ fontSize: 13, opacity: 0.75, marginTop: 4 }}>At least 8 characters.</p>
        {error ? (
          <div className="alert error" role="alert">
            {error}
          </div>
        ) : null}
        <button className="button primary" type="submit" disabled={busy || password.length < 8} style={{ marginTop: 10 }}>
          {busy ? "Saving…" : "Save new password"}
        </button>
      </form>
    </div>
  );
}

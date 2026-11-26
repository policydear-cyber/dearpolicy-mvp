import Link from "next/link";
import { parseEmailLinkType, parseTokenHash } from "@/lib/auth/email-link";

/**
 * Where an emailed link lands (sign-up confirmation, sign-in link, password reset): one button. Only pressing it spends
 * the link's one-time token (app/api/auth/confirm), so a mail scanner or link preview that opens the link cannot use it
 * up, and it works in any browser, including the one inside a mail app (lib/auth/email-link.ts).
 */
export default async function ConfirmPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const tokenHash = parseTokenHash(one(params.token_hash));
  const type = parseEmailLinkType(one(params.type));
  const next = one(params.next) ?? "";
  const reset = type === "recovery";

  if (!tokenHash || !type) {
    return (
      <div className="page" style={{ maxWidth: 420, paddingTop: 96 }}>
        <h1>That link is incomplete</h1>
        <p className="lead">Open the link from the email again, or ask for a new one.</p>
        <p className="auth-links" style={{ marginTop: 16 }}>
          <Link href="/login">Go to sign in</Link>
        </p>
      </div>
    );
  }

  return (
    <div className="page" style={{ maxWidth: 420, paddingTop: 96 }}>
      <h1>{reset ? "Reset your password" : "Confirm your email"}</h1>
      <p className="lead">{reset ? "Continue to choose a new password." : "Continue to confirm your email address and sign in."}</p>
      <form method="post" action="/api/auth/confirm" className="field">
        <input type="hidden" name="token_hash" value={tokenHash} />
        <input type="hidden" name="type" value={type} />
        <input type="hidden" name="next" value={next} />
        <button className="button primary" type="submit" style={{ marginTop: 10 }}>
          {reset ? "Continue" : "Confirm and sign in"}
        </button>
      </form>
    </div>
  );
}

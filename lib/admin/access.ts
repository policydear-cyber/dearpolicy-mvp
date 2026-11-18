/**
 * Who may open the admin console (/admin).
 *
 * An explicit allow-list of email addresses in the ADMIN_EMAILS setting (comma-separated, case-insensitive), read on
 * the server only. Identity comes from the verified Supabase session (lib/auth/session.ts), never from anything the
 * browser sends: no cookie flag, header or query string can make someone an admin.
 *
 * Fails closed: with ADMIN_EMAILS unset or empty, nobody is an admin. An address counts only once Supabase has
 * confirmed it, so signing up with an allow-listed address that isn't yours gives nothing. Everyone else, signed in or
 * not, gets the ordinary "page not found", so the console's existence isn't advertised.
 */
import { notFound } from "next/navigation";
import { getCurrentUser, type SessionUser } from "@/lib/auth/session";

/** The allow-listed addresses, trimmed and lower-cased. Anything that isn't shaped like an address is ignored. */
export function adminEmails(env: NodeJS.ProcessEnv = process.env): Set<string> {
  const raw = env.ADMIN_EMAILS ?? "";
  return new Set(
    raw.split(",").map((s) => s.trim().toLowerCase()).filter((s) => /^[^\s@,]+@[^\s@,]+$/.test(s)),
  );
}

/** True only for a signed-in user whose confirmed email is on the allow-list. */
export function isAdminUser(user: SessionUser | null, env: NodeJS.ProcessEnv = process.env): boolean {
  if (!user || !user.email || !user.emailConfirmedAt) return false;
  const allowed = adminEmails(env);
  if (!allowed.size) return false;
  return allowed.has(user.email.trim().toLowerCase());
}

export type AdminUser = { id: string; email: string };

/** For every admin page and layout: returns the admin, or renders "page not found" for anyone else. */
export async function requireAdminOrNotFound(): Promise<AdminUser> {
  let user: SessionUser | null = null;
  try {
    user = await getCurrentUser();
  } catch {
    user = null;
  }
  if (!isAdminUser(user)) notFound();
  return { id: user!.id, email: user!.email! };
}

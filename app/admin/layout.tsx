import { requireAdminOrNotFound } from "@/lib/admin/access";

// Always evaluated per request: who may see this area is decided by the signed-in session, never by a cached render.
export const dynamic = "force-dynamic";

/**
 * DearPolicy's admin console: households, sign-ups, plans, usage and spend, document read status and recent errors,
 * across every household. Read-only.
 *
 * Gate: the ADMIN_EMAILS allow-list (lib/admin/access.ts), checked on the server against the verified session. Anyone
 * else, a household owner included, gets an ordinary "page not found". Each page checks again itself, because Next.js
 * may render a page alongside its layout.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdminOrNotFound();
  return <>{children}</>;
}

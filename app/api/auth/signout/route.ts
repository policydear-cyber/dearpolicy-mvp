import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { signOutThisDevice } from "@/lib/auth/sign-out";

export const runtime = "nodejs";
export const ROUTE_AUTH = "authenticated" as const;

/** Sign out: this device only (lib/auth/sign-out.ts); the account's other sessions stay signed in. */
export async function POST() {
  const supabase = await createSupabaseServerClient();
  await signOutThisDevice(supabase.auth);
  return NextResponse.json({ ok: true });
}

/**
 * Sign out ends this device's session only (lib/auth/sign-out.ts, app/api/auth/signout/route.ts). Supabase's signOut()
 * with no options uses the "global" scope and revokes every session of the account (live 18 Nov: signing out on one
 * device signed the account out everywhere). A fake auth client; no network.
 *   npm run auth:sign-out-scope-test
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { signOutThisDevice } from "@/lib/auth/sign-out";

let passed = 0;
const failed: string[] = [];
const t = async (name: string, fn: () => Promise<void> | void) => { try { await fn(); passed++; console.log("  ok  " + name); } catch (e) { failed.push(name); console.error("  FAIL " + name + ": " + (e instanceof Error ? e.message.split("\n")[0] : String(e))); } };

/** A fake of the auth client's signOut: two devices of one account, each a session; scopes as Supabase defines them. */
function account() {
  const sessions = new Set(["this-device", "other-device"]);
  const calls: unknown[] = [];
  const auth = {
    async signOut(options?: { scope?: "global" | "local" | "others" }) {
      calls.push(options);
      const scope = options?.scope ?? "global";
      if (scope === "global") sessions.clear();
      else if (scope === "local") sessions.delete("this-device");
      else sessions.delete("other-device");
      return { error: null };
    },
  };
  return { auth, sessions, calls };
}

async function main() {
  await t("signing out ends this device's session and leaves the account's other devices signed in", async () => {
    const a = account();
    await signOutThisDevice(a.auth);
    assert.deepEqual([...a.sessions], ["other-device"]);
    assert.deepEqual(a.calls, [{ scope: "local" }]);
  });
  await t("an error from the auth service never blocks signing out, as before; it is handed back", async () => {
    const r = await signOutThisDevice({ async signOut() { return { error: new Error("auth down") }; } });
    assert.match(String(r.error), /auth down/);
  });
  await t("the Sign out route signs out through it, never with Supabase's default global scope", () => {
    const route = readFileSync("app/api/auth/signout/route.ts", "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    assert.match(route, /signOutThisDevice\(supabase\.auth\)/);
    assert.doesNotMatch(route, /\.signOut\(/);
  });
  console.log(`sign-out scope: ${passed} passed, ${failed.length} failed`);
  if (failed.length) process.exit(1);
}
void main();

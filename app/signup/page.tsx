import Link from "next/link";
import { PRIVACY_NOTICE_FINAL } from "@/lib/privacy/notice-status";
import { signupMode } from "@/lib/auth/signup-gate";
import SignupForm from "./SignupForm";

/** Read on every request: whether sign-up is invite-only is a server setting (DEARPOLICY_SIGNUP_MODE), never baked into
 * the build. The form itself is a client component (./SignupForm.tsx). */
export const dynamic = "force-dynamic";

export default function SignupPage() {
  return (
    <SignupForm
      inviteOnly={signupMode() === "invite"}
      footer={PRIVACY_NOTICE_FINAL ? (
        <p className="field-hint">
          By creating a household you agree to how we handle your information: <Link href="/privacy">privacy notice</Link>.
        </p>
      ) : null}
    />
  );
}

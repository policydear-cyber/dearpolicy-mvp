import Link from "next/link";

/**
 * The privacy notice for the invite-only beta, in plain English. Public (middleware.ts OPEN_PATHS), so a person can read
 * it before signing up. DRAFT: every passage marked "To confirm" needs DC's review before the beta opens; the legal
 * wording (who the operator is, which law applies, contact, where data is kept, backup retention) is DC's to settle.
 * Static text only: it reads nothing from the database and calls no service.
 */
export const metadata = { title: "Privacy · DearPolicy" };

/** A passage DC still has to confirm, shown plainly so nobody mistakes the draft for the final text. */
function ToConfirm({ children }: { children: React.ReactNode }) {
  return <mark className="to-confirm" data-to-confirm="true">To confirm: {children}</mark>;
}

export default function PrivacyPage() {
  return (
    <div className="page" style={{ maxWidth: 720, paddingTop: 48 }} data-testid="privacy-notice">
      <div className="eyebrow">PRIVACY NOTICE · BETA DRAFT</div>
      <h1>How DearPolicy handles your information</h1>
      <p className="lead">
        DearPolicy keeps your family&rsquo;s insurance documents in one place, reads what they cover, and answers your questions about them.
        This notice says what we keep, who helps us run the service, and how you remove your information.
      </p>
      <p className="field-hint">Last updated: <ToConfirm>the date this notice is published.</ToConfirm></p>

      <section className="section">
        <h2>Who we are</h2>
        <p>
          DearPolicy is run by <ToConfirm>the name of the business or person operating DearPolicy, and the country it is based in.</ToConfirm>{" "}
          You can reach us about anything in this notice at <ToConfirm>a contact email address.</ToConfirm>
        </p>
      </section>

      <section className="section">
        <h2>What we keep</h2>
        <ul>
          <li><strong>Your sign-in:</strong> your email address and password. Passwords are handled by our sign-in provider and are never stored in a form anyone can read.</li>
          <li><strong>Your household:</strong> the names you give for the people in it, how they are related to you, and anything else you enter about them, such as a date of birth.</li>
          <li><strong>Your documents:</strong> the policy schedules, certificates, wordings and letters you upload, and what we read from them, such as insurers, policy numbers, covers, amounts, premiums and dates. Insurance documents can contain identity numbers and health information. We show identity numbers masked in answers (for example S****567D).</li>
          <li><strong>Your claims and questions:</strong> claims you start, the evidence you add to them, and your questions and DearPolicy&rsquo;s answers.</li>
          <li><strong>Records that keep the service working:</strong> sign-in attempts (to stop password guessing), error logs, and a record of how much reading and answering each household uses.</li>
        </ul>
      </section>

      <section className="section">
        <h2>How we use it</h2>
        <p>
          Only to run DearPolicy for your household: to show what your policies cover, to answer your questions, to help you prepare a claim, and to keep the service secure and working.
          We do not sell your information, and we do not use it for advertising.
        </p>
      </section>

      <section className="section">
        <h2>Who helps us run the service</h2>
        <ul>
          <li><strong>Anthropic</strong> reads your documents and writes the answers to your questions, using its Claude models. The pages and questions it needs are sent to it for that purpose only. <ToConfirm>Anthropic&rsquo;s commercial terms say it does not use information sent through its API to train its models; check the current terms and the retention period before publishing.</ToConfirm></li>
          <li><strong>Supabase</strong> stores your records and files and handles signing in.</li>
          <li><strong>Vercel</strong> hosts the website.</li>
          <li><ToConfirm>a file-scanning service, if one is switched on to check uploads for malware.</ToConfirm></li>
        </ul>
        <p>Your information is kept in <ToConfirm>the country or region where the database and files are hosted.</ToConfirm></p>
      </section>

      <section className="section">
        <h2>Who can see it</h2>
        <ul>
          <li>The people you invite into your household see that household&rsquo;s records. Every household is kept separate from every other one.</li>
          <li>If you ask DearPolicy to review a claim, the reviewer sees only that claim and the documents it needs, and only while the review is assigned to them.</li>
          <li><ToConfirm>when, if ever, DearPolicy staff may look at a household&rsquo;s records to fix a problem, and whether you are told first.</ToConfirm></li>
        </ul>
      </section>

      <section className="section">
        <h2>Removing your information</h2>
        <ul>
          <li><strong>A document:</strong> delete it from Documents. Its file is removed from storage, and it is no longer used for anything.</li>
          <li><strong>Your whole household:</strong> the owner can choose &ldquo;Permanently delete household&rdquo;. Its family profiles, documents, claims and chats are removed, and their files are deleted from storage straight after.</li>
          <li><strong>A copy first:</strong> the owner can download an export of the household before deleting it.</li>
          <li><strong>Your sign-in:</strong> to close the account itself, contact us at the address above.</li>
          <li><ToConfirm>how long backups keep deleted information before it is gone from them too.</ToConfirm></li>
        </ul>
      </section>

      <section className="section">
        <h2>How we protect it</h2>
        <p>
          Information is encrypted while it travels and where it is stored. Every request is checked against your own household, so one household cannot read another&rsquo;s records.
          No system is perfectly safe; if something goes wrong that affects your information, we will tell you.
        </p>
      </section>

      <section className="section">
        <h2>Your choices and rights</h2>
        <p>
          You can see and change what is kept about your household in the app, and remove it as described above. To ask for a copy, a correction or a deletion we have not covered, contact us.{" "}
          <ToConfirm>which data-protection law applies (for example Singapore&rsquo;s PDPA) and any rights it adds.</ToConfirm>
        </p>
      </section>

      <section className="section">
        <h2>This is a beta</h2>
        <p>
          DearPolicy is in an invite-only beta and still changing. DearPolicy explains your documents; it is not an insurer or a financial adviser, and your insurer decides every claim.
          If this notice changes in a way that matters, we will tell you in the app before it applies.
        </p>
      </section>

      <p style={{ marginTop: 24 }}><Link href="/">Back to DearPolicy</Link></p>
    </div>
  );
}

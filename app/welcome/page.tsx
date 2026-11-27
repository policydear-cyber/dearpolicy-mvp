import type { Metadata } from "next";
import Link from "next/link";
import { Icon, type IconName } from "@/components/icons";
import { PolicySheet } from "@/components/policy-sheet";
import { SITE_DESCRIPTION } from "@/lib/public-site/site";
import { PricingSection } from "@/components/public/pricing-section";
import { purchaseOpen } from "@/lib/plans/purchase-open";

/**
 * The public landing page: what a signed-out visitor sees at "/" (middleware.ts serves this page there; the address
 * bar keeps "/"). Static text only: it reads no session, household, document or chat data and calls no service.
 *
 * Wording follows the marketing plan's rules (/mnt/project-files/marketing/PLAN.md, section 3): no promised payouts,
 * no accuracy figures, never "advice", no endorsement or security claims, and the example uses a made-up family and
 * a made-up insurer.
 */
export const metadata: Metadata = {
  title: "DearPolicy · Know what your insurance actually covers",
  description: SITE_DESCRIPTION,
  alternates: { canonical: "/" },
  openGraph: { title: "DearPolicy · Know what your insurance actually covers", description: SITE_DESCRIPTION, url: "/", siteName: "DearPolicy", type: "website" },
};

// Kept short on purpose (DC, 18 Nov: "too many words"): one line per step, one line per limit. The hero example is the proof.
const STEPS: Array<{ title: string; text: string }> = [
  { title: "Upload your documents", text: "Any insurer, in English. PDFs, scans or photos." },
  { title: "Link each one to a person", text: "Mei\u2019s policy stays Mei\u2019s." },
  { title: "Ask in plain words", text: "Answers show the page they came from." },
];

const LIMITS: Array<{ icon: IconName; text: string }> = [
  { icon: "documents", text: "Amounts keep the currency your document prints. If it shows only \u201c$\u201d, DearPolicy reads it in the currency you choose when you sign up." },
  { icon: "fileOff", text: "Pages it couldn\u2019t read are named, so you know where to look." },
  { icon: "info", text: "It isn\u2019t financial advice and doesn\u2019t sell insurance. Your insurer decides what is paid." },
];

export default function WelcomePage() {
  return (
    <div className="landing" data-testid="landing">
      <section className="landing-hero" aria-labelledby="landing-title">
        <div className="landing-hero-text">
          <h1 id="landing-title">Know what your insurance actually covers.</h1>
          <p className="landing-lead">
            Ask plain questions about your family&rsquo;s policies. DearPolicy answers from your own documents and shows
            the page it used.
          </p>
          <div className="landing-actions">
            <Link className="button primary" href="/signup" data-testid="landing-sign-up">Create an account</Link>
          </div>
        </div>
        <div className="landing-wallet">
        {/* A fan of policy sheets, drawn: one sheet per kind of cover is how Home shows a person's cover. */}
        <div className="landing-fan">
          <PolicySheet card="ci" icon="pulse" title="Critical illness" />
          <PolicySheet card="death" icon="heart" title="Death" />
          <PolicySheet card="hospital" icon="hospital" title="Hospital stay" />
        </div>
        <figure className="landing-example" aria-label="Example question and answer, using a made-up family and insurer">
          <figcaption>Made-up family and insurer</figcaption>
          <p className="landing-bubble landing-bubble-you">Mei broke her wrist at school. Is she covered?</p>
          <div className="landing-bubble landing-bubble-dp">
            <p>
              Mei&rsquo;s <strong>Harbourline Family PA</strong> schedule lists a <strong>Fractures</strong> benefit of up
              to <strong>S$2,000</strong> per accident, for an injury caused by an accident.
            </p>
            <p className="landing-cite"><Icon name="documents" /> Harbourline Family PA Schedule 2026 · Table of benefits · page 2</p>
          </div>
        </figure>
        </div>
      </section>

      <section className="landing-section" aria-labelledby="landing-how">
        <h2 id="landing-how">How it works</h2>
        <ol className="landing-steps">
          {STEPS.map((step, i) => (
            <li key={step.title}>
              <span className="landing-step-no" aria-hidden="true">{i + 1}</span>
              <div><h3>{step.title}</h3><p>{step.text}</p></div>
            </li>
          ))}
        </ol>
      </section>

      <section className="landing-section" aria-labelledby="landing-limits">
        <h2 id="landing-limits">Honest about limits</h2>
        <ul className="landing-grid">
          {LIMITS.map((item) => (
            <li key={item.text}>
              <span className="landing-icon" aria-hidden="true"><Icon name={item.icon} /></span>
              <p>{item.text}</p>
            </li>
          ))}
        </ul>
        <p className="landing-learn">New to insurance? <Link className="text-link" href="/learn">Read the free guides <Icon name="arrowRight" /></Link></p>
      </section>

      <PricingSection billingOpen={purchaseOpen()} />

      <section className="landing-section landing-cta" aria-labelledby="landing-start">
        <h2 id="landing-start">See what your own policies say</h2>
        <div className="landing-actions">
          <Link className="button primary" href="/signup">Create an account</Link>
          <span className="landing-signin">Already have one? <Link className="text-link" href="/login">Sign in</Link></span>
        </div>
      </section>
    </div>
  );
}

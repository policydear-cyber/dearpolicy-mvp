import type { Metadata } from "next";
import Link from "next/link";
import { Icon, type IconName } from "@/components/icons";
import { GUIDES } from "@/lib/learn/content";
import { SITE_DESCRIPTION } from "@/lib/public-site/site";

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

const STEPS: Array<{ icon: IconName; title: string; text: string }> = [
  { icon: "upload", title: "Upload your documents", text: "Policy schedules, policy wordings, certificates and benefit summaries, from any insurer, in English, as PDFs (scanned copies too)." },
  { icon: "family", title: "Link each one to a person", text: "Say whose cover each document is. A policy for your daughter stays hers, even when it shares a policy number with someone else\u2019s." },
  { icon: "ask", title: "Ask in plain words", text: "“Is Mei covered if she breaks her arm?” DearPolicy answers from your own documents and shows the page each answer came from." },
];

const HELPS: Array<{ icon: IconName; title: string; text: string }> = [
  { icon: "household", title: "Everyone’s cover in one place", text: "See what each person in the family holds, sorted by person and by kind of cover." },
  { icon: "documents", title: "Answers you can check", text: "Answers name the document and page they came from, and amounts keep the currency the document states." },
  { icon: "receipt", title: "What you might be able to claim", text: "For an event like a hospital stay or an accident, DearPolicy lists the benefits that may apply and the next steps the policy describes." },
  { icon: "fileOff", title: "Honest about what it couldn’t read", text: "If a page can’t be read, DearPolicy names it, so you know where to look yourself." },
];

const LIMITS = [
  "It explains your documents. It doesn’t sell, compare or recommend insurance, and it isn’t financial advice.",
  "It doesn’t decide claims. Your insurer decides what is paid, after checking the claim.",
  "A figure it works out for your situation is an illustration from the policy’s own terms, labelled as one, not a promise of payment.",
  "If something isn’t in your documents, it says so instead of guessing.",
];

const FEATURED_GUIDES = ["your-documents", "how-amounts-work", "making-a-claim", "sg-medishield-life"];

export default function WelcomePage() {
  const guides = FEATURED_GUIDES.map((slug) => GUIDES.find((g) => g.slug === slug)).filter((g): g is (typeof GUIDES)[number] => Boolean(g));
  return (
    <div className="landing" data-testid="landing">
      <section className="landing-hero" aria-labelledby="landing-title">
        <div className="landing-hero-text">
          <h1 id="landing-title">Know what your insurance actually covers.</h1>
          <p className="landing-lead">
            Upload your family&rsquo;s insurance documents, link each one to the right person, and ask plain questions.
            DearPolicy answers from your own documents and shows the page each answer came from.
          </p>
          <div className="landing-actions">
            <Link className="button primary" href="/signup" data-testid="landing-sign-up">Create an account</Link>
            <Link className="button secondary" href="/login" data-testid="landing-sign-in">Sign in</Link>
          </div>
          <p className="landing-small">It explains your policies. It doesn&rsquo;t sell you one.</p>
        </div>
        <figure className="landing-example" aria-label="Example question and answer, using a made-up family and insurer">
          <figcaption>Example with a made-up family and insurer</figcaption>
          <p className="landing-bubble landing-bubble-you">Mei fell at school and broke her wrist. Is she covered?</p>
          <div className="landing-bubble landing-bubble-dp">
            <p>
              Mei&rsquo;s <strong>Harbourline Family Personal Accident</strong> schedule lists a <strong>Fractures</strong> benefit
              of up to <strong>S$2,000</strong> per accident, for an injury caused by an accident.
            </p>
            <p className="landing-cite"><Icon name="documents" /> Harbourline Family PA Schedule 2026 · Table of benefits · page 2</p>
            <p>The policy asks for the claim to be reported within 30 days. Your insurer decides what is paid.</p>
          </div>
        </figure>
      </section>

      <section className="landing-section" aria-labelledby="landing-how">
        <h2 id="landing-how">How it works</h2>
        <ol className="landing-steps">
          {STEPS.map((step, i) => (
            <li key={step.title}>
              <span className="landing-icon" aria-hidden="true"><Icon name={step.icon} /></span>
              <div><h3><span className="landing-step-no">{i + 1}.</span> {step.title}</h3><p>{step.text}</p></div>
            </li>
          ))}
        </ol>
      </section>

      <section className="landing-section" aria-labelledby="landing-helps">
        <h2 id="landing-helps">What it helps with</h2>
        <ul className="landing-grid">
          {HELPS.map((item) => (
            <li key={item.title}>
              <span className="landing-icon" aria-hidden="true"><Icon name={item.icon} /></span>
              <h3>{item.title}</h3>
              <p>{item.text}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="landing-section landing-limits" aria-labelledby="landing-limits">
        <h2 id="landing-limits">What DearPolicy is not</h2>
        <ul>
          {LIMITS.map((line) => <li key={line}><Icon name="info" /><span>{line}</span></li>)}
        </ul>
      </section>

      <section className="landing-section" aria-labelledby="landing-learn">
        <h2 id="landing-learn">Learn the basics, free</h2>
        <p className="landing-lead">Short guides to how insurance works, with Singapore schemes explained from official sources. No account needed.</p>
        <ul className="landing-guides">
          {guides.map((guide) => (
            <li key={guide.slug}><Link className="landing-guide" href={`/learn/${guide.slug}`}><strong>{guide.title}</strong><span>{guide.summary}</span></Link></li>
          ))}
        </ul>
        <p><Link className="text-link" href="/learn">See all guides <Icon name="arrowRight" /></Link></p>
      </section>

      <section className="landing-section landing-cta" aria-labelledby="landing-start">
        <h2 id="landing-start">See what your own policies say</h2>
        <p className="landing-lead">Create an account, upload a document, and ask your first question.</p>
        <div className="landing-actions">
          <Link className="button primary" href="/signup">Create an account</Link>
          <Link className="button secondary" href="/login">Sign in</Link>
        </div>
      </section>
    </div>
  );
}

"use client";
import Link from "next/link";
import { PlanCards } from "@/components/plan-cards";
import { PLANS } from "@/lib/plans/catalogue";

/**
 * The landing page's pricing section (DC, 18 Nov: prices shown before sign-up; every sign-up starts on Free; Plus and Family are
 * said to be coming soon while billing is off, DC 27 Nov). Static: no session, household or service is read. One button on every card, "Start free", because
 * nobody pays at sign-up.
 */
export function PricingSection() {
  return <section className="landing-section" aria-labelledby="landing-pricing" data-testid="landing-pricing">
    <h2 id="landing-pricing">Pricing</h2>
    <p className="landing-lead">Every account starts on Free, with no card needed. Plus and Family are coming soon.</p>
    <PlanCards action={(plan) => <Link className={"button" + (plan.id === "plus" ? " primary" : "")} href="/signup" data-testid={"pricing-start-" + plan.id}>Start free</Link>} />
    <div className="plan-faq">
      <h3>What counts as a document?</h3>
      <p>Each file you keep in DearPolicy. A newer copy that replaces one you have doesn&rsquo;t count again, and neither does a file DearPolicy couldn&rsquo;t read. Deleting a document frees its place.</p>
      <h3>What happens at a limit?</h3>
      <p>DearPolicy tells you and keeps everything you have. A question counts once it&rsquo;s sent, and questions start again on the 1st of each month. Family has no set document limit, within fair use of {PLANS.family.documents} documents.</p>
      <h3>Can I cancel?</h3>
      <p>Yes, any time. Your plan runs to the end of the period you paid for, then moves to Free. Nothing is deleted.</p>
    </div>
  </section>;
}

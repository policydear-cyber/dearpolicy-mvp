"use client";

import { useId, useState } from "react";
import { percentOf, plainNumber, splitBill, type LimitApplies } from "@/lib/learn/try-it";

/**
 * The library's interactive pieces. Everything here uses MADE-UP numbers typed into the page itself: nothing reads the
 * household's policies, calls a service or costs anything. Every result is labelled as an illustration.
 */

function Slider({ label, value, min, max, step, onChange, suffix = "" }: {
  label: string; value: number; min: number; max: number; step: number; onChange: (n: number) => void; suffix?: string;
}) {
  const id = useId();
  return (
    <div className="ti-slider">
      <label htmlFor={id}><span>{label}</span><output htmlFor={id}>{plainNumber(value)}{suffix}</output></label>
      <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  );
}

const MADE_UP = "Example only: made-up numbers in no particular currency, not your policy.";

/** How a deductible, a co-payment and a limit split one covered bill (one common order). */
export function BillSplitTry() {
  const [bill, setBill] = useState(10000);
  const [deductible, setDeductible] = useState(1000);
  const [pct, setPct] = useState(10);
  const [limit, setLimit] = useState(20000);
  const [limitApplies, setLimitApplies] = useState<LimitApplies>("share");
  const s = splitBill({ bill, deductible, coPaymentPercent: pct, limit, limitApplies });
  const share = (n: number) => `${bill > 0 ? (n / bill) * 100 : 0}%`;
  return (
    <figure className="learn-try" data-testid="learn-bill-split">
      <figcaption><strong>Try it: who pays what?</strong><span>{MADE_UP}</span></figcaption>
      <div className="ti-bar" role="img" aria-label={`Bar: of a bill of ${plainNumber(bill)}, the illustrated policy share is ${plainNumber(s.policyShare)} and your share is ${plainNumber(s.yourShare)}.`}>
        <span className="ti-seg ti-policy" style={{ width: share(s.policyShare) }} />
        <span className="ti-seg ti-deductible" style={{ width: share(s.deductible) }} />
        <span className="ti-seg ti-copay" style={{ width: share(s.coPayment) }} />
        <span className="ti-seg ti-over" style={{ width: share(s.overLimit) }} />
      </div>
      <ul className="ti-legend">
        <li><i className="ti-policy" />Policy&rsquo;s share (illustration) <b>{plainNumber(s.policyShare)}</b></li>
        <li><i className="ti-deductible" />Deductible, you pay <b>{plainNumber(s.deductible)}</b></li>
        <li><i className="ti-copay" />Co-payment, you pay <b>{plainNumber(s.coPayment)}</b></li>
        {s.overLimit > 0 ? <li><i className="ti-over" />Above the limit, you pay <b>{plainNumber(s.overLimit)}</b></li> : null}
      </ul>
      <p className="ti-result" aria-live="polite">Your share in this example: <b>{plainNumber(s.yourShare)}</b> of {plainNumber(bill)}.</p>
      <div className="ti-controls">
        <Slider label="Covered bill" value={bill} min={1000} max={30000} step={500} onChange={setBill} />
        <Slider label="Deductible" value={deductible} min={0} max={5000} step={100} onChange={setDeductible} />
        <Slider label="Co-payment" value={pct} min={0} max={50} step={5} onChange={setPct} suffix="%" />
        <Slider label="Limit for this bill" value={limit} min={1000} max={30000} step={500} onChange={setLimit} />
        <fieldset className="ti-switch">
          <legend>The limit applies to</legend>
          <div>
            <button type="button" aria-pressed={limitApplies === "share"} onClick={() => setLimitApplies("share")}>The policy&rsquo;s share</button>
            <button type="button" aria-pressed={limitApplies === "bill"} onClick={() => setLimitApplies("bill")}>The bill, first</button>
          </div>
        </fieldset>
      </div>
      <p className="ti-note">{limitApplies === "share"
        ? "In this order the deductible comes off first, then the co-payment, and the limit caps what the policy pays."
        : "In this order the limit caps the bill first, then the deductible and co-payment come off what is left. Many hospital plans work this way."}{" "}
        Policies differ in which order they use and may have other limits; your policy wording says which applies. Your insurer decides what it pays.</p>
    </figure>
  );
}

/** A percentage of a sum assured, as a bar. */
export function PercentOfSumTry() {
  const [pct, setPct] = useState(25);
  const sum = 100000;
  const amount = percentOf(pct, sum);
  return (
    <figure className="learn-try" data-testid="learn-percent-of-sum">
      <figcaption><strong>Try it: a percentage of the sum assured</strong><span>{MADE_UP}</span></figcaption>
      <div className="ti-bar" role="img" aria-label={`Bar: ${pct}% of ${plainNumber(sum)} is ${plainNumber(amount)}.`}>
        <span className="ti-seg ti-policy" style={{ width: `${pct}%` }} />
      </div>
      <p className="ti-result" aria-live="polite">{pct}% of a sum assured of {plainNumber(sum)} is <b>{plainNumber(amount)}</b> in this example.</p>
      <div className="ti-controls">
        <Slider label="Percentage the cover states" value={pct} min={0} max={100} step={5} onChange={setPct} suffix="%" />
      </div>
      <p className="ti-note">Always check what the percentage is of. It may be the sum assured of the main policy, of a rider, or another amount.</p>
    </figure>
  );
}

/** One multiple-choice question with instant feedback. Retry is allowed; nothing is recorded. */
export function Quiz({ question, options, answer, explain }: { question: string; options: string[]; answer: number; explain: string }) {
  const [picked, setPicked] = useState<number | null>(null);
  const right = picked === answer;
  return (
    <div className="learn-quiz" data-testid="learn-quiz" role="group" aria-label="Quick check">
      <p className="lq-label">Quick check</p>
      <p className="lq-question">{question}</p>
      <div className="lq-options">
        {options.map((option, i) => (
          <button key={i} type="button" aria-pressed={picked === i}
            className={picked === null ? "" : i === answer ? "is-right" : picked === i ? "is-wrong" : ""}
            onClick={() => setPicked(i)}>{option}</button>
        ))}
      </div>
      <div aria-live="polite">
        {picked === null ? null : (
          <p className={right ? "lq-feedback is-right" : "lq-feedback is-wrong"}>
            <strong>{right ? "That's right." : "Not quite."}</strong> {explain}
          </p>
        )}
      </div>
    </div>
  );
}

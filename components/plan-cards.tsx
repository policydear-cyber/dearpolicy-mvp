"use client";
import { useState, type ReactNode } from "react";
import { Icon } from "@/components/icons";
import { PLANS, PLAN_ORDER, documentsLabel, formatSgd, type BillingInterval, type Plan, type PlanId } from "@/lib/billing/plans";
import "./plan-cards.css";

/**
 * The three plans side by side, with a monthly or yearly switch (yearly first: two months free). Used on the landing
 * page's pricing section (before sign-up) and on Plan usage (to upgrade). Every number comes from lib/billing/plans.ts.
 * Static: reads no household data. `action` draws each card's button, so the landing page says "Start free" and
 * Plan usage says "Upgrade".
 */
export function PlanCards({ current = null, action, headingLevel = "h3" }: {
  current?: PlanId | null;
  action: (plan: Plan, interval: BillingInterval) => ReactNode;
  headingLevel?: "h3" | "h4";
}) {
  const [interval, setInterval] = useState<BillingInterval>("year");
  const Heading = headingLevel;
  return <div className="plan-cards-wrap">
    <div className="plan-interval" role="group" aria-label="Pay monthly or yearly">
      <button type="button" aria-pressed={interval === "year"} className={interval === "year" ? "on" : ""} onClick={() => setInterval("year")}>Yearly <span>2 months free</span></button>
      <button type="button" aria-pressed={interval === "month"} className={interval === "month" ? "on" : ""} onClick={() => setInterval("month")}>Monthly</button>
    </div>
    <ul className="plan-cards" data-testid="plan-cards">
      {PLAN_ORDER.map((id) => {
        const plan = PLANS[id];
        const free = plan.priceMonthlySgd === 0;
        const price = interval === "year" ? plan.priceYearlySgd : plan.priceMonthlySgd;
        return <li key={id} className={"plan-card" + (id === "plus" ? " featured" : "") + (current === id ? " current" : "")} data-testid={"plan-card-" + id}>
          <div className="plan-card-head">
            <Heading>{plan.name}</Heading>
            {current === id ? <span className="plan-badge">Your plan</span> : id === "plus" ? <span className="plan-badge">Most households</span> : null}
          </div>
          <p className="plan-price"><strong>{formatSgd(price)}</strong>{free ? <span> forever</span> : <span> a {interval}</span>}</p>
          <p className="plan-tagline">{plan.tagline}</p>
          <ul className="plan-features">
            <li><Icon name="check" />{documentsLabel(plan)}</li>
            <li><Icon name="check" />{plan.questionsPerMonth} questions a month</li>
            <li><Icon name="check" />Everyone in your family</li>
          </ul>
          <div className="plan-card-action">{action(plan, interval)}</div>
        </li>;
      })}
    </ul>
  </div>;
}

import type { InsurerContact } from "@/types";

/** How to reach each insurer the answer relies on, as the household's own documents print it (the server reads these from
 * the stored pages; lib/simple-chat/insurer-contacts.ts). A phone number dials, an email opens a message, a website
 * opens in a new tab. Nothing is drawn when no contact was found. */
export function InsurerContacts({ contacts }: { contacts?: InsurerContact[] | null }) {
  const list = (contacts ?? []).filter((c) => c.items?.length);
  if (!list.length) return null;
  const href = (kind: string, value: string) => kind === "phone" ? `tel:${value.replace(/[^\d+]/g, "")}`
    : kind === "email" ? `mailto:${value}` : /^https?:\/\//i.test(value) ? value : `https://${value}`;
  return <div className="insurer-contacts" data-testid="insurer-contacts">
    {list.map((c) => <div className="insurer-contact" key={c.insurer} data-testid="insurer-contact">
      <strong>Contact {c.insurer}</strong>
      <ul>{c.items.map((item) => <li key={item.kind + item.value}>
        <span className="insurer-contact-label">{item.label}</span>{" "}
        <a href={href(item.kind, item.value)} {...(item.kind === "website" ? { target: "_blank", rel: "noopener noreferrer" } : {})}>{item.value}</a>
        <small title={`${item.source.policyName}, page ${item.source.page}`}> · {item.source.policyName}, p.{item.source.page}</small>
      </li>)}</ul>
    </div>)}
  </div>;
}

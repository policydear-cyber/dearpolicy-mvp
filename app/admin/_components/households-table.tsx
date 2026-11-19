"use client";

/**
 * The admin console's households table: search, quick filters, sort by any column, and a spreadsheet download.
 * It only rearranges rows the server already rendered for an allow-listed admin (app/admin/page.tsx); it fetches
 * nothing. Types only from server modules, so no server code reaches the browser bundle.
 */
import Link from "next/link";
import { useMemo, useState } from "react";
import type { HouseholdRow } from "@/lib/admin/console";

const PLAN_NAME: Record<HouseholdRow["plan"], string> = { free: "Free", plus: "Plus", family: "Family" };
const DAY_MS = 86_400_000;

type SortKey = "name" | "owner" | "created" | "plan" | "members" | "people" | "documents" | "read" | "unreadable" | "questions" | "spend" | "lastSignIn";
type Filter = "all" | "active" | "unreadable" | "paid" | "empty";

const COLUMNS: { key: SortKey; label: string; numeric?: boolean }[] = [
  { key: "name", label: "Household" },
  { key: "owner", label: "Owner" },
  { key: "plan", label: "Plan" },
  { key: "documents", label: "Documents", numeric: true },
  { key: "read", label: "Read", numeric: true },
  { key: "unreadable", label: "Unreadable", numeric: true },
  { key: "questions", label: "Questions", numeric: true },
  { key: "spend", label: "Spend", numeric: true },
  { key: "members", label: "Members", numeric: true },
  { key: "people", label: "People", numeric: true },
  { key: "created", label: "Joined" },
  { key: "lastSignIn", label: "Last sign-in" },
];

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "active", label: "Active in 30 days" },
  { key: "unreadable", label: "Has unreadable documents" },
  { key: "paid", label: "Paid plan" },
  { key: "empty", label: "No documents yet" },
];

const time = (v: string | null) => {
  if (!v) return 0;
  const t = Date.parse(v.trim().replace(" ", "T").replace(/([+-]\d\d)$/, "$1:00"));
  return Number.isNaN(t) ? 0 : t;
};

function sortValue(h: HouseholdRow, key: SortKey): string | number {
  switch (key) {
    case "name": return (h.name || h.id).toLowerCase();
    case "owner": return (h.ownerEmail ?? "").toLowerCase();
    case "created": return time(h.createdAt);
    case "plan": return ["free", "plus", "family"].indexOf(h.plan);
    case "members": return h.members;
    case "people": return h.people;
    case "documents": return h.documents;
    case "read": return h.documentsRead;
    case "unreadable": return h.documentsUnreadable;
    case "questions": return h.questionsThisMonth ?? -1;
    case "spend": return h.spendUsd ?? -1;
    case "lastSignIn": return time(h.lastSignInAt);
  }
}

/** A spreadsheet cell: quoted, and a leading = + - @ (a formula) neutralised, since household names are typed by users. */
export function csvCell(v: string | number | null): string {
  if (v == null) return "";
  let s = String(v);
  // Spreadsheets also run a formula after leading spaces or a line break, so those are checked too.
  if (typeof v === "string" && /^[\s]*[=+\-@]|^[\t\r\n]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) || s.startsWith("'") ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Rows as a spreadsheet. Dates are the Singapore-time labels the page shows, not the database's UTC text. */
export function householdsCsv(rows: HouseholdRow[], whenLabels: Record<string, { created: string; lastSignIn: string }> = {}): string {
  const head = ["Household", "Household id", "Owner email", "Plan", "Plan status", "Documents", "Read", "Unreadable", "Still being read",
    "Questions this month", "Model spend this month (USD)", "Model calls", "Members", "People", "Joined (Singapore time)", "Last sign-in (Singapore time)"];
  const lines = rows.map((h) => [h.name, h.id, h.ownerEmail, PLAN_NAME[h.plan], h.planStatus, h.documents, h.documentsRead, h.documentsUnreadable,
    h.documentsInProgress, h.questionsThisMonth, h.spendUsd == null ? null : h.spendUsd.toFixed(4), h.modelCalls, h.members, h.people,
    whenLabels[h.id]?.created ?? h.createdAt, whenLabels[h.id]?.lastSignIn ?? h.lastSignInAt].map(csvCell).join(","));
  return [head.join(","), ...lines].join("\r\n");
}

export function HouseholdsTable({ rows, now, whenLabels }: {
  rows: HouseholdRow[];
  /** Server time (ms), so "active in 30 days" doesn't depend on the viewer's clock. */
  now: number;
  /** Dates already formatted on the server (Singapore time), by household id. */
  whenLabels: Record<string, { created: string; lastSignIn: string }>;
}) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "created", dir: -1 });

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = rows.filter((h) => {
      if (needle && !`${h.name} ${h.ownerEmail ?? ""} ${h.id}`.toLowerCase().includes(needle)) return false;
      if (filter === "active") return time(h.lastSignInAt) >= now - 30 * DAY_MS;
      if (filter === "unreadable") return h.documentsUnreadable > 0;
      if (filter === "paid") return h.plan !== "free";
      if (filter === "empty") return h.documents === 0;
      return true;
    });
    return [...list].sort((a, b) => {
      const x = sortValue(a, sort.key), y = sortValue(b, sort.key);
      return (x < y ? -1 : x > y ? 1 : 0) * sort.dir;
    });
  }, [rows, q, filter, sort, now]);

  const toggleSort = (key: SortKey, numeric?: boolean) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: numeric || key === "created" || key === "lastSignIn" ? -1 : 1 }));

  const download = () => {
    const blob = new Blob(["﻿" + householdsCsv(shown, whenLabels)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `dearpolicy-households-${new Date(now).toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className="admin-panel admin-table-panel" data-testid="admin-households-table">
      <div className="admin-toolbar">
        <div className="field admin-search">
          <label htmlFor="admin-search">Search households</label>
          <input id="admin-search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, owner email or id" autoComplete="off" />
        </div>
        <button type="button" className="button secondary compact" onClick={download} disabled={!shown.length}>Download as spreadsheet (CSV)</button>
      </div>
      <div className="admin-seg" role="group" aria-label="Show households">
        {FILTERS.map((f) => (
          <button key={f.key} type="button" className={`admin-seg-item${filter === f.key ? " active" : ""}`} aria-pressed={filter === f.key} onClick={() => setFilter(f.key)}>
            {f.label}
          </button>
        ))}
      </div>
      <p className="admin-count" aria-live="polite">Showing {shown.length.toLocaleString()} of {rows.length.toLocaleString()} {rows.length === 1 ? "household" : "households"}</p>
      <div className="admin-table-scroll">
        <table className="admin-table">
          <thead>
            <tr>
              {COLUMNS.map((c) => {
                const active = sort.key === c.key;
                return (
                  <th key={c.key} className={c.numeric ? "num" : undefined} aria-sort={active ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
                    <button type="button" onClick={() => toggleSort(c.key, c.numeric)}>
                      {c.label}<span className="admin-sort" aria-hidden="true">{active ? (sort.dir === 1 ? "▲" : "▼") : "↕"}</span>
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {shown.map((h) => (
              <tr key={h.id}>
                <td><Link className="admin-row-link" href={`/admin/households/${h.id}`}>{h.name || "Unnamed household"}</Link><small className="admin-id">{h.id.slice(0, 8)}</small></td>
                <td className="admin-email">{h.ownerEmail ?? "—"}</td>
                <td>{PLAN_NAME[h.plan]}{h.planStatus && h.planStatus !== "active" ? <small className="admin-id">{h.planStatus.replace(/_/g, " ")}</small> : null}</td>
                <td className="num">{h.documents}</td>
                <td className="num">{h.documentsRead}</td>
                <td className="num">{h.documentsUnreadable ? <span className="admin-flag critical">{h.documentsUnreadable} unreadable</span> : 0}</td>
                <td className="num">{h.questionsThisMonth ?? "—"}</td>
                <td className="num">{h.spendUsd == null ? "—" : "US$" + h.spendUsd.toFixed(h.spendUsd > 0 && h.spendUsd < 0.1 ? 4 : 2)}</td>
                <td className="num">{h.members}</td>
                <td className="num">{h.people}</td>
                <td>{whenLabels[h.id]?.created ?? "—"}</td>
                <td>{whenLabels[h.id]?.lastSignIn ?? "—"}</td>
              </tr>
            ))}
            {!shown.length && <tr><td colSpan={COLUMNS.length} className="admin-empty-row">{rows.length ? "No households match. Try another search or filter." : "No households yet."}</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

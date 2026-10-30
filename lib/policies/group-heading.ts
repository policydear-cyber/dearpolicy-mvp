/** A benefit group's heading on the Benefits pages. Two documents can print the same readable name ("Insurer policy
 * wording"): those are told apart as "1 of 2". Runs in the browser: no database code here. */
export type Named = { productName: string | null; documentName: string; insurer?: string | null };

/** Which group a benefit is shown in: one per plan of one insurer, and one per document with no plan name. A plan name is
 * not unique across insurers: a reader may take a section heading as the plan ("Hospitalisation" on a travel insurer's
 * table and on a group scheme's summary), and two insurers' rows must never share one group, its insurer and its owners. */
export function benefitGroupKey(b: { productName: string | null; insurer?: string | null; policyId: string }): string {
  return b.productName != null ? (b.insurer ?? "") + "\u0000" + b.productName : "doc:" + b.policyId;
}

export function groupHeading(groups: [string, Named[]][], key: string): string {
  const name = (rows: Named[]) => rows[0].productName ?? rows[0].documentName;
  const own = groups.find(([k]) => k === key)?.[1];
  if (!own) return key;
  // Numbered only among groups the page cannot tell apart: same name and same insurer (the insurer heads each group).
  const same = groups.filter(([, rows]) => name(rows) === name(own) && (rows[0].insurer ?? null) === (own[0].insurer ?? null));
  return same.length > 1 ? name(own) + " (" + (same.findIndex(([k]) => k === key) + 1) + " of " + same.length + ")" : name(own);
}

/** A benefit group's heading on the Benefits pages. Two documents can print the same readable name ("Insurer policy
 * wording"): those are told apart as "1 of 2". Runs in the browser: no database code here. */
export type Named = { productName: string | null; documentName: string };

export function groupHeading(groups: [string, Named[]][], key: string): string {
  const name = (rows: Named[]) => rows[0].productName ?? rows[0].documentName;
  const own = groups.find(([k]) => k === key)?.[1];
  if (!own) return key;
  const same = groups.filter(([, rows]) => name(rows) === name(own));
  return same.length > 1 ? name(own) + " (" + (same.findIndex(([k]) => k === key) + 1) + " of " + same.length + ")" : name(own);
}

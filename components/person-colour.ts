import type { CSSProperties } from "react";

/** Each family member keeps one colour wherever they appear (Portfolio,
 * Family, Documents), so "whose is this" reads at a glance. Pale tile with
 * the dark of its own hue as ink; hues sit at least 60 degrees apart. The
 * colour follows the person's place in the household's family list. */
const LIGHT = [
  ["#dcf1ff", "#0a3a80"], // blue
  ["#fdecc8", "#7a4300"], // amber
  ["#dcfae5", "#14532d"], // green
  ["#efe4ff", "#4c1d95"], // violet
  ["#ffe4ea", "#881337"], // rose
  ["#d5f5f3", "#134e4a"], // teal
];

export function personColour(id: string | null | undefined, family: { id: string }[]): CSSProperties | undefined {
  const index = id ? family.findIndex((m) => m.id === id) : -1;
  if (index < 0) return undefined;
  const [bg, ink] = LIGHT[index % LIGHT.length];
  return { "--person-bg": bg, "--person-ink": ink } as CSSProperties;
}

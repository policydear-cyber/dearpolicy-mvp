import type { ReactNode } from "react";
import "@/components/learn/learn.css";

/** The knowledge library's own styles (components/learn/learn.css), loaded only on /learn pages. No data, no wrapper markup. */
export default function LearnLayout({ children }: { children: ReactNode }) {
  return children;
}

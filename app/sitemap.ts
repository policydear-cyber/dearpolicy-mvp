import type { MetadataRoute } from "next";
import { GUIDES, TERMS_PAGE } from "@/lib/learn/content";
import { siteUrl } from "@/lib/public-site/site";

/** Every public page: the landing page, the Learn index, each guide and the A to Z of terms. No household page. */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = siteUrl();
  return [
    { url: `${base}/`, changeFrequency: "monthly", priority: 1 },
    { url: `${base}/learn`, changeFrequency: "weekly", priority: 0.8 },
    ...GUIDES.map((guide) => ({
      url: `${base}/learn/${guide.slug}`,
      ...(guide.checkedOn ? { lastModified: guide.checkedOn } : {}),
      changeFrequency: "monthly" as const,
      priority: 0.7,
    })),
    { url: `${base}/learn/${TERMS_PAGE.slug}`, changeFrequency: "monthly", priority: 0.5 },
  ];
}

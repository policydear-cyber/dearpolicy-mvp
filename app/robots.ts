import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/public-site/site";

/** Crawlers may read the landing page and the Learn library only; everything else is a household's own space (it
 * answers a signed-out visitor with the sign-in page, or 401 for an API) and is kept out of search results. */
export default function robots(): MetadataRoute.Robots {
  const base = siteUrl();
  return {
    rules: [{ userAgent: "*", allow: ["/$", "/learn", "/_next/static/", "/dearpolicy-logo.png", "/icon.png"], disallow: ["/"] }],
    sitemap: `${base}/sitemap.xml`,
  };
}

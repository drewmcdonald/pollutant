import type { MetadataRoute } from "next";

/**
 * Restrictive robots.txt per requirements.md §15: the app relies on
 * non-guessable slugs/secrets rather than an index, so nothing should be
 * crawled. Per-route `noindex, nofollow, noarchive` metadata backs this up
 * for crawlers that ignore robots.txt.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      disallow: "/",
    },
  };
}

import type { Metadata } from "next";

/**
 * Every route under a host secret is a bearer-credential surface
 * (requirements.md §15): possession of the URL grants control, so we keep
 * referrer data from ever leaving this origin — a copy/pasted host link
 * must never leak into another site's server logs via the Referer header.
 */
export const metadata: Metadata = {
  title: "Host",
  referrer: "no-referrer",
};

export default function HostLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}

import type { Metadata, Viewport } from "next";
import "./globals.css";
import { headers } from "next/headers";
import AppShell from "@/components/AppShell";
import { SITE_DESCRIPTION, siteUrl } from "@/lib/public-site/site";

export const metadata: Metadata = {
  // The page title is set per page by components/AppShell.tsx (signed in) or by each public page's own metadata.
  metadataBase: new URL(siteUrl()),
  description: SITE_DESCRIPTION,
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f9f5e4" },
    { media: "(prefers-color-scheme: dark)", color: "#1c1512" },
  ],
  viewportFit: "cover",
  // Android: the on-screen keyboard shrinks the layout, so the chat box
  // stays above it instead of being covered.
  interactiveWidget: "resizes-content",
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // middleware.ts sets this on every public page ("0" = no session); anywhere else it is absent and the app menu shows.
  const signedIn = (await headers()).get("x-dearpolicy-signed-in") !== "0";
  return (
    <html lang="en" data-theme="light" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: `try{var t=localStorage.getItem("dearpolicy-theme");if(t==="dark")document.documentElement.setAttribute("data-theme","dark")}catch(e){}` }} />
      </head>
      <body>
        <AppShell signedIn={signedIn}>{children}</AppShell>
      </body>
    </html>
  );
}

import type { Metadata, Viewport } from "next";
import "./globals.css";
import AppShell from "@/components/AppShell";

export const metadata: Metadata = {
  title: "DearPolicy",
  description: "Your family's insurance, understood and ready when you need it.",
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

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" data-theme="light" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: `try{var t=localStorage.getItem("dearpolicy-theme");if(t==="dark")document.documentElement.setAttribute("data-theme","dark")}catch(e){}` }} />
      </head>
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}

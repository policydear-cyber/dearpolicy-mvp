import type { NextConfig } from "next";

// Every response from this app can carry a household's private insurance,
// health and financial data, behind nothing more than one shared password
// (see lib/auth/gate.ts) -- these are the baseline response headers any
// app in that position should send regardless of what a browser happens to
// do by default. Deliberately conservative: no Content-Security-Policy
// script-src/style-src restriction here, because this repo cannot exercise
// a real browser to verify one wouldn't break Next's own inline hydration
// output; frame-ancestors (below) is the one CSP directive that is safe to
// set blind, since nothing in this app legitimately embeds itself in a
// frame either way.
const SECURITY_HEADERS = [
  // Stops a browser from guessing a different content type than the
  // response declares (e.g. treating an uploaded PDF as HTML/script).
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Belt-and-braces alongside the CSP frame-ancestors directive below --
  // older browsers that ignore CSP still honour this header. Nothing in
  // DearPolicy is meant to be embedded in another site's frame.
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  // Don't leak the current page's full URL (which can contain no secrets
  // today, but may in future carry a claim or policy id) to a third-party
  // site linked from within the app.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // None of camera, microphone, geolocation or payment APIs are used
  // anywhere in this app; deny them so an embedded third-party script
  // (now or later) can't invoke them either.
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  // Ignored by the browser over plain HTTP (local dev); tells it to only
  // ever reach this origin over HTTPS in production, including on the
  // first visit for anyone who has seen it before.
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  output: "standalone",
  async headers() {
    return [{ source: "/(.*)", headers: SECURITY_HEADERS }];
  },
  serverExternalPackages: ["pdfjs-dist"],
  // pdfjs-dist's legacy build polyfills DOMMatrix from its OPTIONAL
  // @napi-rs/canvas dependency the moment it's imported -- and because that
  // require is optional and conditional, Next's standalone file trace (static
  // analysis) never follows it, so the native binary never made it into the
  // deployed function. The result on Vercel was "ReferenceError: DOMMatrix is
  // not defined" on every single PDF upload and reprocess, in production,
  // the whole time: nothing was ever actually read. This forces the traced
  // Linux glibc build (Vercel's serverless runtime) into the two routes that
  // read PDFs.
  outputFileTracingIncludes: {
    "/api/policies/**": [
      "node_modules/@napi-rs/canvas/**",
      "node_modules/@napi-rs/canvas-linux-x64-gnu/**",
      // pdf.worker.mjs is loaded via a runtime-computed relative import
      // (`GlobalWorkerOptions.workerSrc ||= "./pdf.worker.mjs"`), which the
      // trace's static analysis can't follow either -- same failure shape as
      // the DOMMatrix issue above, just one layer further in: once DOMMatrix
      // was fixed, every re-analysis failed instead with "Setting up fake
      // worker failed: Cannot find module .../pdf.worker.mjs". cmaps and
      // standard_fonts cover embedded/non-standard fonts in real policy PDFs
      // that a plain test document would never exercise, so they're included
      // now rather than surfacing as a third silent gap later.
      "node_modules/pdfjs-dist/legacy/build/**",
      "node_modules/pdfjs-dist/cmaps/**",
      "node_modules/pdfjs-dist/standard_fonts/**",
    ],
  },
};

export default nextConfig;

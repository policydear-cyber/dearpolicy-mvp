import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
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

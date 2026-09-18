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
    ],
  },
};

export default nextConfig;

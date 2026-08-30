import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Fail the production build on type errors instead of silently shipping them.
  typescript: {
    ignoreBuildErrors: false,
  },
  eslint: {
    ignoreDuringBuilds: false,
  },
  // pdf-parse (via pdfjs-dist) does its own dynamic module loading that
  // Next's server bundler can't statically analyze — bundling it breaks
  // with "Object.defineProperty called on non-object" at request time.
  // Keeping it external makes Node load it normally instead.
  serverExternalPackages: ["pdf-parse", "pdfjs-dist"],
  outputFileTracingIncludes: {
    // pdfjs-dist loads its worker script (pdf.worker.mjs) via a runtime-
    // computed path, not a static import, so Vercel's output-file tracer
    // doesn't detect it and drops it from the deployed function — even
    // pdf.js's own in-process "fake worker" fallback needs this file to
    // exist. Confirmed live: "Setting up fake worker failed: Cannot find
    // module '.../pdfjs-dist/legacy/build/pdf.worker.mjs'" in production.
    // This is a plain JS file, unlike the native-binary dependency that
    // caused problems earlier, so forcing it in is safe here.
    "/api/files/parse": ["./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs"],
  },
};

export default nextConfig;

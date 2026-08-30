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
  serverExternalPackages: ["pdf-parse", "pdfjs-dist", "@napi-rs/canvas"],
  outputFileTracingIncludes: {
    // pdfjs-dist requires @napi-rs/canvas conditionally at runtime (a
    // try/catch require for its optional DOMMatrix/Canvas polyfill).
    // Vercel's automatic output-file tracer doesn't follow that dynamic
    // require, so the package gets silently dropped from the deployed
    // function bundle — confirmed live (a real ReferenceError: DOMMatrix
    // is not defined in production, absent locally). This forces it in.
    "/api/files/parse": ["./node_modules/@napi-rs/canvas/**"],
  },
};

export default nextConfig;

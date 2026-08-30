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
};

export default nextConfig;

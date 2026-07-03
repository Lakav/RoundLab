import type { NextConfig } from "next";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(fileURLToPath(import.meta.url));

// Static export keeps the app hostable as plain HTML/JS/CSS. The parser still
// runs locally in the browser through the Web Worker + WASM path.
const nextConfig: NextConfig = {
  turbopack: {
    root: projectRoot,
  },
  output: "export",
  images: {
    // `next/image` optimization requires a server — disable for static export.
    unoptimized: true,
  },
  // Keep exported routes and dev routes consistent.
  trailingSlash: true,
};

export default nextConfig;

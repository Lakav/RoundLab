import type { NextConfig } from "next";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(fileURLToPath(import.meta.url));

// Static export for the Tauri desktop build: Next produces a plain HTML/JS/CSS
// renderer bundle in `out/`. No server runtime.
const nextConfig: NextConfig = {
  turbopack: {
    root: projectRoot,
  },
  output: "export",
  images: {
    // `next/image` optimization requires a server — disable for static export.
    unoptimized: true,
  },
  // Tauri serves assets via a custom protocol; trailing slash makes the dev
  // and bundled routing consistent.
  trailingSlash: true,
};

export default nextConfig;

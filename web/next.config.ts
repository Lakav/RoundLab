import type { NextConfig } from "next";

// Static export for the Tauri desktop build: Next produces a plain HTML/JS/CSS
// bundle in `out/` that Tauri serves as the frontend. No server runtime.
const nextConfig: NextConfig = {
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

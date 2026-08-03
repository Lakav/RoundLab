import type { NextConfig } from "next";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(fileURLToPath(import.meta.url));
const repositoryName = process.env.GITHUB_REPOSITORY?.split("/")[1];
const deployBasePath = process.env.GITHUB_ACTIONS === "true" && repositoryName
  ? `/${repositoryName}`
  : "";

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
  basePath: deployBasePath,
  assetPrefix: deployBasePath || undefined,
  env: {
    NEXT_PUBLIC_BASE_PATH: deployBasePath,
  },
};

export default nextConfig;

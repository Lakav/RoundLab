// API base resolver.
//
// In production the backend runs on Railway at NEXT_PUBLIC_API_URL.
// If that env var is unset we fall back to same-origin (useful for local
// dev where a Go server on :8080 could be fronted by the Next.js dev
// server, or if someone ever brings the old Next.js API routes back).
export function apiBase(): string {
  const raw = process.env.NEXT_PUBLIC_API_URL;
  if (!raw) return "";
  return raw.replace(/\/+$/, "");
}

export function apiUrl(path: string): string {
  if (!path.startsWith("/")) path = "/" + path;
  return apiBase() + path;
}

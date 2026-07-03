import type { RoundLabBackend } from "@/lib/backends/types";
import { createBrowserBackend } from "@/lib/backends/browser";

let backend: RoundLabBackend | null = null;

export function getBackend(): RoundLabBackend {
  if (backend) return backend;
  backend = createBrowserBackend();
  return backend;
}

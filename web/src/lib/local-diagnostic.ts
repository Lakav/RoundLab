export const LOCAL_DIAGNOSTIC_SCHEMA = "roundlab.local-diagnostic.v1" as const;

export type DiagnosticSource =
  | "route-boundary"
  | "global-boundary"
  | "unhandled-error"
  | "unhandled-rejection"
  | "worker";

export type DiagnosticCategory =
  | "quota"
  | "indexeddb"
  | "worker"
  | "wasm"
  | "backup"
  | "network"
  | "unknown";

export type LocalDiagnostic = {
  schema: typeof LOCAL_DIAGNOSTIC_SCHEMA;
  createdAt: string;
  source: DiagnosticSource;
  category: DiagnosticCategory;
  errorName: string;
  route: "home" | "match" | "feedback" | "unknown";
  environment: {
    online: boolean | null;
    language: string | null;
    indexedDbAvailable: boolean;
    workerAvailable: boolean;
    storageManagerAvailable: boolean;
  };
  privacy: {
    rawMessageIncluded: false;
    stackIncluded: false;
    demoIncluded: false;
    playerIdentityIncluded: false;
    localPathIncluded: false;
  };
};

function errorName(error: unknown): string {
  if (error instanceof DOMException || error instanceof Error) return error.name || "Error";
  return "UnknownError";
}

export function diagnosticCategory(error: unknown, source: DiagnosticSource): DiagnosticCategory {
  const name = errorName(error).toLowerCase();
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (name.includes("quota") || message.includes("quota")) return "quota";
  if (name.includes("indexeddb") || message.includes("indexeddb")) return "indexeddb";
  if (source === "worker" || name.includes("worker") || message.includes("worker")) return "worker";
  if (
    name.includes("wasm")
    || message.includes("wasm")
    || name.includes("webassembly")
    || message.includes("webassembly")
  ) return "wasm";
  if (message.includes("backup") || message.includes("sauvegarde")) return "backup";
  if (name.includes("network") || message.includes("fetch")) return "network";
  return "unknown";
}

function genericRoute(): LocalDiagnostic["route"] {
  if (typeof window === "undefined") return "unknown";
  const pathname = window.location.pathname.replace(/\/$/, "");
  if (pathname.endsWith("/match")) return "match";
  if (pathname.endsWith("/feedback")) return "feedback";
  if (pathname === "" || pathname.endsWith("/RoundLab")) return "home";
  return "unknown";
}

export function createLocalDiagnostic(
  error: unknown,
  source: DiagnosticSource,
  now = new Date(),
): LocalDiagnostic {
  const browser = typeof window !== "undefined";
  return {
    schema: LOCAL_DIAGNOSTIC_SCHEMA,
    createdAt: now.toISOString(),
    source,
    category: diagnosticCategory(error, source),
    errorName: errorName(error).slice(0, 80),
    route: genericRoute(),
    environment: {
      online: browser && typeof navigator.onLine === "boolean" ? navigator.onLine : null,
      language: browser && typeof navigator.language === "string"
        ? navigator.language.slice(0, 32)
        : null,
      indexedDbAvailable: browser && "indexedDB" in window,
      workerAvailable: browser && "Worker" in window,
      storageManagerAvailable: browser && "storage" in navigator,
    },
    privacy: {
      rawMessageIncluded: false,
      stackIncluded: false,
      demoIncluded: false,
      playerIdentityIncluded: false,
      localPathIncluded: false,
    },
  };
}

export function serializeLocalDiagnostic(diagnostic: LocalDiagnostic): string {
  return `${JSON.stringify(diagnostic, null, 2)}\n`;
}

export function downloadLocalDiagnostic(diagnostic: LocalDiagnostic): void {
  const blob = new Blob([serializeLocalDiagnostic(diagnostic)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `roundlab-diagnostic-${diagnostic.createdAt.replaceAll(":", "-")}.json`;
    anchor.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}

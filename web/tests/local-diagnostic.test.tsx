import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ErrorRecoveryPanel } from "@/components/ErrorRecoveryPanel";
import { UnhandledErrorMonitor } from "@/components/UnhandledErrorMonitor";
import {
  createLocalDiagnostic,
  diagnosticCategory,
  serializeLocalDiagnostic,
} from "@/lib/local-diagnostic";

describe("privacy-preserving local diagnostics", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("classifies critical local failure families without preserving raw content", () => {
    expect(diagnosticCategory(new DOMException("full", "QuotaExceededError"), "route-boundary"))
      .toBe("quota");
    expect(diagnosticCategory(new Error("IndexedDB open failed"), "route-boundary"))
      .toBe("indexeddb");
    expect(diagnosticCategory(new Error("WebAssembly trap"), "route-boundary"))
      .toBe("wasm");
    expect(diagnosticCategory(new Error("corrupt backup"), "route-boundary"))
      .toBe("backup");
    expect(diagnosticCategory("plain rejection", "worker")).toBe("worker");
  });

  it("never serializes a demo name, player identity, Steam ID, path, message or stack", () => {
    window.history.replaceState({}, "", "/RoundLab/match/?id=private-match");
    const error = new Error(
      "Alice 76561198000000000 /Users/alice/private/final.dem C:\\Users\\alice\\final.dem",
    );
    error.stack = "private stack with Bob";
    const diagnostic = createLocalDiagnostic(error, "route-boundary", new Date("2026-08-03T10:00:00Z"));
    const serialized = serializeLocalDiagnostic(diagnostic);

    expect(diagnostic.route).toBe("match");
    expect(serialized).not.toMatch(/Alice|Bob|76561198000000000|final\.dem|private-match|Users/);
    expect(diagnostic.privacy).toEqual({
      rawMessageIncluded: false,
      stackIncluded: false,
      demoIncluded: false,
      playerIdentityIncluded: false,
      localPathIncluded: false,
    });
  });

  it("offers retry, home and a safe clipboard diagnostic", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const retry = vi.fn();
    render(
      <ErrorRecoveryPanel
        error={new Error("private-player-name")}
        source="route-boundary"
        onRetry={retry}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Réessayer" }));
    expect(retry).toHaveBeenCalledOnce();
    expect(screen.getByRole("link", { name: "Revenir à l’accueil" })).toHaveAttribute("href", "/");
    fireEvent.click(screen.getByRole("button", { name: "Copier le diagnostic" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledOnce());
    expect(writeText.mock.calls[0][0]).not.toContain("private-player-name");
    expect(await screen.findByText("Diagnostic copié.")).toBeInTheDocument();
  });

  it("surfaces unhandled promise rejections and lets the user dismiss them", async () => {
    render(<UnhandledErrorMonitor />);
    const event = new Event("unhandledrejection") as PromiseRejectionEvent;
    Object.defineProperty(event, "reason", { value: new Error("secret rejection") });
    window.dispatchEvent(event);
    expect(await screen.findByRole("alert")).toHaveTextContent("Une erreur a interrompu RoundLab");
    fireEvent.click(screen.getByRole("button", { name: "Fermer" }));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const createBrowserBackend = vi.fn(() => ({ kind: "browser" }));

vi.mock("@/lib/backends/browser", () => ({ createBrowserBackend }));

describe("backend selection", () => {
  beforeEach(() => {
    vi.resetModules();
    createBrowserBackend.mockClear();
  });

  it("creates one browser backend and reuses it", async () => {
    const { getBackend } = await import("@/lib/backends");
    const first = getBackend();
    const second = getBackend();
    expect(first).toBe(second);
    expect(createBrowserBackend).toHaveBeenCalledOnce();
  });
});

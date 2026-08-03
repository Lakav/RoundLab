import { afterEach, describe, expect, it, vi } from "vitest";
import {
  actionableStorageError,
  isQuotaExceededError,
  readStorageStatus,
  requestPersistentStorage,
} from "@/lib/storage-safety";

describe("browser storage safety", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reports unsupported storage managers without throwing", async () => {
    vi.stubGlobal("navigator", {});
    await expect(readStorageStatus()).resolves.toEqual({
      supported: false,
      persisted: null,
      usageBytes: null,
      quotaBytes: null,
    });
  });

  it("reads quota and explicitly requests persistence", async () => {
    const persist = vi.fn().mockResolvedValue(true);
    const persisted = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const estimate = vi.fn().mockResolvedValue({ usage: 12, quota: 100 });
    vi.stubGlobal("navigator", { storage: { persist, persisted, estimate } });

    await expect(readStorageStatus()).resolves.toMatchObject({ persisted: false, usageBytes: 12, quotaBytes: 100 });
    await expect(requestPersistentStorage()).resolves.toMatchObject({ persisted: true });
    expect(persist).toHaveBeenCalledOnce();
  });

  it("turns quota failures into an actionable message", () => {
    const quota = new DOMException("full", "QuotaExceededError");
    expect(isQuotaExceededError(quota)).toBe(true);
    expect(actionableStorageError(quota).message).toContain("stockage local est plein");
  });
});

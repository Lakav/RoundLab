export type StorageStatus = {
  supported: boolean;
  persisted: boolean | null;
  usageBytes: number | null;
  quotaBytes: number | null;
};

function storageManager(): StorageManager | null {
  if (typeof navigator === "undefined" || !("storage" in navigator)) return null;
  return navigator.storage;
}

export async function readStorageStatus(): Promise<StorageStatus> {
  const storage = storageManager();
  if (!storage) {
    return { supported: false, persisted: null, usageBytes: null, quotaBytes: null };
  }

  const [persisted, estimate] = await Promise.all([
    typeof storage.persisted === "function" ? storage.persisted().catch(() => null) : null,
    typeof storage.estimate === "function" ? storage.estimate().catch(() => null) : null,
  ]);
  return {
    supported: true,
    persisted,
    usageBytes: typeof estimate?.usage === "number" ? estimate.usage : null,
    quotaBytes: typeof estimate?.quota === "number" ? estimate.quota : null,
  };
}

export async function requestPersistentStorage(): Promise<StorageStatus> {
  const storage = storageManager();
  if (storage && typeof storage.persist === "function") {
    await storage.persist().catch(() => false);
  }
  return readStorageStatus();
}

export function isQuotaExceededError(error: unknown): boolean {
  return error instanceof DOMException &&
    (error.name === "QuotaExceededError" || error.name === "NS_ERROR_DOM_QUOTA_REACHED");
}

export function actionableStorageError(error: unknown): Error {
  if (isQuotaExceededError(error)) {
    return new Error(
      "Le stockage local est plein. Exporte une sauvegarde, puis supprime des matchs ou libère de l’espace avant de réessayer.",
      { cause: error },
    );
  }
  return error instanceof Error ? error : new Error("Le stockage local a échoué pour une raison inconnue.");
}

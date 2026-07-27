export const BROWSER_DB_VERSION = 2;
export const MATCH_STORE = "matches";
export const ROUND_STORE = "rounds";
export const META_STORE = "meta";

export type BrowserStoreSchemaRecord = {
  key: "schema";
  version: number;
};

type BrowserStoreMigration = {
  version: number;
  migrate: (db: IDBDatabase, transaction: IDBTransaction) => void;
};

function createInitialStores(db: IDBDatabase): void {
  if (!db.objectStoreNames.contains(MATCH_STORE)) {
    db.createObjectStore(MATCH_STORE, { keyPath: "id" });
  }
  if (!db.objectStoreNames.contains(ROUND_STORE)) {
    const rounds = db.createObjectStore(ROUND_STORE, { keyPath: "key" });
    rounds.createIndex("matchId", "matchId", { unique: false });
  }
}

function addSchemaMetadata(db: IDBDatabase, transaction: IDBTransaction): void {
  const metadata = db.objectStoreNames.contains(META_STORE)
    ? transaction.objectStore(META_STORE)
    : db.createObjectStore(META_STORE, { keyPath: "key" });
  const rounds = transaction.objectStore(ROUND_STORE);
  if (!rounds.indexNames.contains("matchId")) {
    rounds.createIndex("matchId", "matchId", { unique: false });
  }
  metadata.put({
    key: "schema",
    version: 2,
  } satisfies BrowserStoreSchemaRecord);
}

const BROWSER_STORE_MIGRATIONS: BrowserStoreMigration[] = [
  { version: 1, migrate: (db) => createInitialStores(db) },
  { version: 2, migrate: addSchemaMetadata },
];

export function runBrowserStoreMigrations(
  db: IDBDatabase,
  transaction: IDBTransaction,
  oldVersion: number,
  newVersion: number | null,
): void {
  const targetVersion = newVersion ?? BROWSER_DB_VERSION;
  for (let version = oldVersion + 1; version <= targetVersion; version++) {
    const migration = BROWSER_STORE_MIGRATIONS.find((candidate) => candidate.version === version);
    if (!migration) {
      throw new Error(`Missing IndexedDB migration for version ${version}.`);
    }
    migration.migrate(db, transaction);
  }
}

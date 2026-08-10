// IndexedDB-backed storage adapter for zustand's `persist` middleware.
//
// WHY NOT localStorage: an offline round is unsynced data — the only copy of
// several hours of play. WebView localStorage is evictable under storage
// pressure and is synchronous (it blocks the main thread on every write, and we
// write on every shot). IndexedDB is the durable, async option.
//
// The adapter is generic; `createIdbStorage(name)` returns something that
// satisfies zustand's async StateStorage contract.

import { get, set, del, createStore, type UseStore } from 'idb-keyval';
import type { StateStorage } from 'zustand/middleware';

const DB_NAME = 'grt-store';

function storeFor(name: string): UseStore {
  return createStore(DB_NAME, name);
}

/**
 * Whether IndexedDB exists at all.
 *
 * Absent under Node (tests, SSR) and in a few locked-down WebViews. That's not a
 * failure — it's a different environment — so we fall through to localStorage
 * quietly rather than logging a warning per read.
 */
function idbAvailable(): boolean {
  return typeof indexedDB !== 'undefined';
}

/**
 * One-time lift of an existing localStorage value into IndexedDB.
 *
 * Without this, shipping the storage swap would silently abandon any round in
 * progress at update time — the golfer relaunches mid-round and finds nothing.
 * Runs before the first read; leaves the localStorage copy in place as a
 * fallback rather than deleting it, so a rollback doesn't strand the data
 * either.
 */
async function migrateFromLocalStorage(name: string, idb: UseStore): Promise<void> {
  if (!idbAvailable()) return;
  try {
    const existing = await get(name, idb);
    if (existing !== undefined) return; // already migrated
    const legacy = lsGet(name);
    if (legacy == null) return;
    await set(name, legacy, idb);
    console.info(`[idbStorage] migrated "${name}" from localStorage`);
  } catch (err) {
    console.warn(`[idbStorage] migration of "${name}" failed`, err);
  }
}

/**
 * Every localStorage touch is guarded. It throws outright in a few environments
 * (Node under test, Safari private mode, WebViews with storage disabled), and
 * these calls sit in the FALLBACK path — a throw there would escape the very
 * catch block meant to keep a round safe.
 */
function lsGet(key: string): string | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage.getItem(key);
  } catch {
    return null;
  }
}

function lsSet(key: string, value: string): boolean {
  try {
    if (typeof localStorage === 'undefined') return false;
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function lsRemove(key: string) {
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

export function createIdbStorage(name: string): StateStorage {
  // Everything is created lazily on first use. Building the IDB handle at
  // module-import time would make merely importing the store hit the database,
  // which breaks in any non-browser context.
  let idb: UseStore | null = null;
  let migrated: Promise<void> | null = null;

  const ready = () => {
    if (!idb) {
      idb = storeFor(name);
      migrated = migrateFromLocalStorage(name, idb);
    }
    return { idb: idb!, migrated: migrated! };
  };

  return {
    getItem: async (key) => {
      if (!idbAvailable()) return lsGet(key);
      try {
        const { idb: db, migrated: m } = ready();
        await m;
        const v = await get<string>(key, db);
        return v ?? null;
      } catch (err) {
        // Fall back to localStorage rather than reporting "no round" — a read
        // failure must never look like an absent round to the store.
        console.warn('[idbStorage] getItem failed, falling back', err);
        return lsGet(key);
      }
    },

    setItem: async (key, value) => {
      if (!idbAvailable()) {
        lsSet(key, value);
        return;
      }
      try {
        const { idb: db } = ready();
        await set(key, value, db);
      } catch (err) {
        // Last-ditch: keep the round somewhere rather than losing the write.
        console.warn('[idbStorage] setItem failed, falling back', err);
        if (!lsSet(key, value)) {
          console.error('[idbStorage] both IDB and localStorage writes failed');
        }
      }
    },

    removeItem: async (key) => {
      if (idbAvailable()) {
        try {
          const { idb: db } = ready();
          await del(key, db);
        } catch (err) {
          console.warn('[idbStorage] removeItem failed', err);
        }
      }
      // Clear the legacy copy too, or a reset would resurrect it on next load.
      lsRemove(key);
    }
  };
}

/**
 * Browser-local session helpers for Music Scribe / Bandscribe.
 *
 * First slice: UI prefs stay in localStorage; song audio/results live only in the
 * localhost helper's ephemeral job dir (wiped on helper start / Clear local data).
 * IndexedDB is reserved for a future fully client-held result cache — not a cloud sync.
 *
 * Heavy ML is NOT claimed to run in this tab yet (see inference-stub.js).
 */
const LocalStore = (() => {
  const IDB_NAME = "musicscribe-local";
  const IDB_VERSION = 1;

  function openDb() {
    return new Promise((resolve, reject) => {
      if (!("indexedDB" in window)) return resolve(null);
      const req = indexedDB.open(IDB_NAME, IDB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("session")) db.createObjectStore("session");
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function idbClear() {
    const db = await openDb().catch(() => null);
    if (!db) return;
    return new Promise(resolve => {
      const tx = db.transaction("session", "readwrite");
      tx.objectStore("session").clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  }

  function clearLocalStoragePrefs() {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && (k.startsWith("bandscribe.") || k.startsWith("chordy."))) keys.push(k);
    }
    keys.forEach(k => localStorage.removeItem(k));
  }

  /** Wipe browser prefs + IndexedDB session + ask the localhost helper to delete jobs. */
  async function clearAllLocalData() {
    clearLocalStoragePrefs();
    await idbClear();
    const res = await fetch("/api/privacy/clear", { method: "POST" });
    if (!res.ok) {
      let msg = res.statusText;
      try { msg = (await res.json()).detail || msg; } catch { /* */ }
      throw new Error(msg);
    }
    return res.json();
  }

  return { openDb, clearAllLocalData, clearLocalStoragePrefs };
})();

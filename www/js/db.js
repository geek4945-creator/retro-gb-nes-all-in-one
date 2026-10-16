// Tiny IndexedDB wrapper: ROM library + auto-resume states. ROMs are stored as ArrayBuffers
// (more reliable than Blobs in older iOS Safari builds).
const DB_NAME = 'retro-pocket', VERSION = 1;
let dbp;
function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('roms')) db.createObjectStore('roms', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('states')) db.createObjectStore('states', { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}
async function tx(store, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const out = fn(t.objectStore(store));
    t.oncomplete = () => resolve(out && 'result' in out ? out.result : undefined);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}
export const putRom = (rom) => tx('roms', 'readwrite', (s) => s.put(rom));
export const getRom = (id) => tx('roms', 'readonly', (s) => s.get(id));
export const allRoms = () => tx('roms', 'readonly', (s) => s.getAll());
export const deleteRom = (id) => tx('roms', 'readwrite', (s) => s.delete(id));
export const putState = (st) => tx('states', 'readwrite', (s) => s.put(st));
export const getState = (id) => tx('states', 'readonly', (s) => s.get(id));
export const deleteState = (id) => tx('states', 'readwrite', (s) => s.delete(id));
export const allStateIds = () => tx('states', 'readonly', (s) => s.getAllKeys());

export async function sha256Hex(buf) {
  if (crypto && crypto.subtle) {
    const d = await crypto.subtle.digest('SHA-256', buf);
    return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
  }
  let h = 2166136261; const u = new Uint8Array(buf);        // fallback: FNV-1a + size
  for (let i = 0; i < u.length; i++) { h ^= u[i]; h = Math.imul(h, 16777619) >>> 0; }
  return 'f' + h.toString(16) + u.length.toString(16);
}

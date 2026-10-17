// Tiny IndexedDB wrapper: ROM library + auto-resume states. ROMs are stored as ArrayBuffers
// (more reliable than Blobs in older iOS Safari builds).
const DB_NAME = 'retro-pocket', VERSION = 3;
let dbp;
function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('roms')) db.createObjectStore('roms', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('states')) db.createObjectStore('states', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('art')) db.createObjectStore('art', { keyPath: 'id' });     // cover art per ROM id
      if (!db.objectStoreNames.contains('bios')) db.createObjectStore('bios', { keyPath: 'id' });   // user-supplied BIOS files (never bundled), id = system/name
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'id' });   // cached thumbnail name indexes
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
export const putArt = (a) => tx('art', 'readwrite', (s) => s.put(a));
export const getArt = (id) => tx('art', 'readonly', (s) => s.get(id));
export const allArt = () => tx('art', 'readonly', (s) => s.getAll());
export const deleteArt = (id) => tx('art', 'readwrite', (s) => s.delete(id));
export const putMeta = (m) => tx('meta', 'readwrite', (s) => s.put(m));
export const getMeta = (id) => tx('meta', 'readonly', (s) => s.get(id));
export const putBios = (b) => tx('bios', 'readwrite', (s) => s.put(b));
export const allBios = () => tx('bios', 'readonly', (s) => s.getAll());
export const deleteBios = (id) => tx('bios', 'readwrite', (s) => s.delete(id));
export const biosFor = async (system) => (await allBios()).filter((b) => b.system === system);
export const allStateIds = () => tx('states', 'readonly', (s) => s.getAllKeys());

export async function sha256Hex(buf) {
  if (buf.byteLength > 48 * 1048576) {                 // huge disc images: id = size + first/middle/last 4 MB (hashing 600 MB on a phone is slow)
    const u = new Uint8Array(buf), n = u.length, q = 4 * 1048576, mid = Math.floor(n / 2) - q / 2;
    const small = new Uint8Array(q * 3 + 8); small.set(u.subarray(0, q), 0); small.set(u.subarray(mid, mid + q), q); small.set(u.subarray(n - q), q * 2);
    new DataView(small.buffer).setFloat64(q * 3, n);
    buf = small.buffer;
  }
  if (crypto && crypto.subtle) {
    const d = await crypto.subtle.digest('SHA-256', buf);
    return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
  }
  let h = 2166136261; const u = new Uint8Array(buf);        // fallback: FNV-1a + size
  for (let i = 0; i < u.length; i++) { h ^= u[i]; h = Math.imul(h, 16777619) >>> 0; }
  return 'f' + h.toString(16) + u.length.toString(16);
}

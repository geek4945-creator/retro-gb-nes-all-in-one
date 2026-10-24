// ROM folders: remember one or more folders and "Scan for new ROMs" (adds only files that are not in the library yet).
// Three back-ends, picked per platform:
//   saf    – Android APK: native Capacitor plugin "RomFolders" (Storage Access Framework, ACTION_OPEN_DOCUMENT_TREE with a
//            persisted read permission; recursive listing + chunked reads). Survives restarts -> auto-scan on launch.
//   fsa    – Chrome/Edge (desktop + Android): File System Access API showDirectoryPicker(); the directory handle is stored in
//            IndexedDB and permission is re-checked (and re-requested with a tap when the browser asks again).
//   import – iPhone/iPad Safari, Firefox: no persistent folder access exists. A multi-file / webkitdirectory picker is used
//            ("Scan Downloads": Browse -> Downloads -> Select All); duplicates are skipped by name+size and by content hash.
import * as db from './db.js';
import { EXT_TO_SYSTEM, AMBIGUOUS, extOf, titleFrom } from './cores.js';
import { parseCue, parseM3u } from './detect.js';

export const MAX_ROM = 1200 * 1024 * 1024;
const ROM_EXTS = new Set([...Object.keys(EXT_TO_SYSTEM), ...Object.keys(AMBIGUOUS), 'zip', '7z', 'cue', 'm3u', 'bin', 'iso', 'chd', 'ccd', 'img', 'pbp']);
const NEVER = new Set(['txt', 'nfo', 'pdf', 'jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'mp3', 'mp4', 'mkv', 'sav', 'srm', 'state', 'dat', 'xml', 'json', 'html', 'htm', 'ini', 'cfg', 'apk', 'exe', 'dll', 'db', 'sfv', 'md5', 'log', 'ips', 'bps', 'ups', 'doc', 'docx', 'rar']);
export const isRomName = (name) => { const n = String(name || ''); if (!n || n.startsWith('.')) return false; const e = extOf(n); return !NEVER.has(e) && ROM_EXTS.has(e); };

const cap = () => window.Capacitor;
export const isApk = () => !!(cap() && cap().isNativePlatform && cap().isNativePlatform());
export const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const native = (method, opts = {}) => cap().nativePromise('RomFolders', method, opts);
/** 'saf' | 'fsa' | 'import' */
export function folderMode() {
  if (isApk() && cap().nativePromise) return 'saf';
  if (typeof window.showDirectoryPicker === 'function' && !isIOS()) return 'fsa';
  return 'import';
}
export const dirPickerSupported = () => 'webkitdirectory' in document.createElement('input');

export const listFolders = async () => (await db.allFolders().catch(() => [])).sort((a, b) => a.added - b.added);
const newId = () => 'f' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

/** Opens the platform folder picker and remembers the folder. Returns the folder record or null (cancelled). */
export async function addFolder() {
  const mode = folderMode();
  if (mode === 'saf') {
    const r = await native('pick', { initial: 'Download' });
    if (!r || !r.uri) return null;
    const existing = (await listFolders()).find((f) => f.uri === r.uri); if (existing) return existing;
    const f = { id: newId(), kind: 'saf', name: r.name || 'Folder', uri: r.uri, added: Date.now(), lastScan: 0, fileCount: 0, lastAdded: 0, seen: {} };
    await db.putFolder(f); return f;
  }
  if (mode === 'fsa') {
    let handle;
    try { handle = await window.showDirectoryPicker({ id: 'rp-roms', mode: 'read', startIn: 'downloads' }); }
    catch (e) { if (e && e.name === 'AbortError') return null; try { handle = await window.showDirectoryPicker(); } catch (e2) { if (e2 && e2.name === 'AbortError') return null; throw e2; } }
    for (const f of await listFolders()) if (f.handle && f.handle.isSameEntry && await f.handle.isSameEntry(handle).catch(() => false)) return f;
    const f = { id: newId(), kind: 'fsa', name: handle.name, handle, added: Date.now(), lastScan: 0, fileCount: 0, lastAdded: 0, seen: {} };
    await db.putFolder(f); return f;
  }
  return null;            // 'import' has no persistent folders: use importFiles() with a picked FileList
}
export async function removeFolder(f) {
  if (f.kind === 'saf') await native('release', { uri: f.uri }).catch(() => {});
  await db.deleteFolder(f.id);
}

/** Permission state of a remembered folder: 'granted' | 'prompt' | 'denied' | 'repick' (iOS import records). */
export async function folderAccess(f, { request = false } = {}) {
  if (f.kind === 'import') return 'repick';
  if (f.kind === 'saf') { try { const r = await native('check', { uri: f.uri }); return r && r.ok ? 'granted' : 'denied'; } catch { return 'denied'; } }
  try {
    let p = await f.handle.queryPermission({ mode: 'read' });
    if (p !== 'granted' && request) p = await f.handle.requestPermission({ mode: 'read' });
    return p;
  } catch { return 'denied'; }
}

/* ---------- listing (each entry: { path, name, size, mtime, get(): Promise<File> }) ---------- */
async function listFsa(handle, onProgress) {
  const out = [];
  const walk = async (dir, prefix, depth) => {
    for await (const h of dir.values()) {
      if (h.name.startsWith('.')) continue;
      if (h.kind === 'directory') { if (depth < 8) await walk(h, prefix + h.name + '/', depth + 1); continue; }
      if (!isRomName(h.name)) { out.skipped = (out.skipped || 0) + 1; continue; }
      const file = await h.getFile();
      out.push({ path: prefix + h.name, name: h.name, size: file.size, mtime: file.lastModified, get: async () => file });
      if (out.length % 25 === 0) onProgress(`Listing… ${out.length} ROM files`);
    }
  };
  await walk(handle, '', 0);
  return out;
}
const b64ToBytes = (b64) => { const s = atob(b64), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; };
async function readSaf(e) {
  const CH = 3 * 1024 * 1024, parts = []; let off = 0;
  for (;;) {
    const r = await native('read', { id: e.id, offset: off, length: CH });
    const u = b64ToBytes(r.data || ''); parts.push(u); off += u.length;
    if (r.eof || !u.length) break;
  }
  return new File(parts, e.name, { lastModified: e.mtime || Date.now() });
}
async function listSaf(f, onProgress) {
  onProgress('Listing folder…');
  const r = await native('list', { uri: f.uri });
  const all = (r && r.files) || [];
  const out = all.filter((e) => isRomName(e.name)).map((e) => ({ path: e.path || e.name, name: e.name, size: e.size, mtime: e.mtime, get: () => readSaf(e) }));
  out.skipped = all.length - out.length;
  return out;
}
const listFiles = (files) => {
  const all = [...files], out = all.filter((f) => isRomName(f.name)).map((f) => ({ path: f.webkitRelativePath || f.name, name: f.name, size: f.size, mtime: f.lastModified, get: async () => f }));
  out.skipped = all.length - out.length;
  return out;
};

/* ---------- scanning ---------- */
const dirOf = (p) => p.includes('/') ? p.slice(0, p.lastIndexOf('/') + 1) : '';
const sig = (e) => `${e.size}:${e.mtime || 0}`;
function libraryKeys(roms) {
  const k = new Set();
  for (const r of roms) {
    if (r.origName) k.add(`${r.origName.toLowerCase()}|${r.origSize}`);
    if (r.file) k.add(`${r.file.toLowerCase()}|${r.size}`);
    if (r.title) k.add(`t:${r.title.toLowerCase()}|${r.size}`);
  }
  return k;
}
const inLibrary = (keys, e) => keys.has(`${e.name.toLowerCase()}|${e.size}`) || keys.has(`t:${titleFrom(e.name).toLowerCase()}|${e.size}`);

/**
 * Adds the new ROMs among `entries`. `importFiles(files, opts)` is app.js' importer (system detection, cue/bin bundling,
 * hash de-dupe). Returns { added, dup, skipped, needChoice, problems, newRoms, total, fresh }.
 */
async function scanEntries(folder, entries, { importFiles, getRoms, onProgress = () => {} }) {
  const nonRom = entries.skipped || 0;
  const seen = folder.seen || {}, keys = libraryKeys(await getRoms());
  const big = entries.filter((e) => e.size > MAX_ROM);
  entries = entries.filter((e) => e.size > 0 && e.size <= MAX_ROM);
  const byDir = new Map();
  for (const e of entries) { const d = dirOf(e.path); if (!byDir.has(d)) byDir.set(d, new Map()); byDir.get(d).set(e.name.toLowerCase(), e); }
  // cue sheets / playlists: their track files are bundled with them and never imported on their own
  const refs = new Map(), referenced = new Set();
  for (const e of entries.filter((x) => ['cue', 'm3u'].includes(extOf(x.name)))) {
    let names = [];
    try { const t = await (await e.get()).text(); names = extOf(e.name) === 'cue' ? parseCue(t) : parseM3u(t); } catch {}
    const dir = byDir.get(dirOf(e.path)), list = names.map((n) => dir.get(n.toLowerCase())).filter(Boolean);
    refs.set(e, list); for (const x of list) referenced.add(x);
  }
  const expand = (e, acc = new Set()) => { if (acc.has(e)) return acc; acc.add(e); for (const x of refs.get(e) || []) expand(x, acc); return acc; };
  const isNew = (e) => seen[e.path] !== sig(e) && !inLibrary(keys, e);
  const groups = [];
  for (const e of entries) {
    if (referenced.has(e)) continue;                                        // a .bin of a .cue (or a .cue of an .m3u): imported with its parent
    const g = [...expand(e)];
    if (g.some(isNew)) groups.push(g); else for (const x of g) seen[x.path] = sig(x);
  }
  const res = { added: 0, dup: 0, skipped: big.length, needChoice: 0, problems: big.map((e) => `“${e.name}” is too large`), newRoms: [], total: entries.length, fresh: groups.length, nonRom };
  let i = 0;
  for (const g of groups) {
    i++; onProgress(`Adding ${i}/${groups.length}: ${g[0].name}`, i / groups.length);
    try {
      const files = []; for (const e of g) files.push(await e.get());
      const r = await importFiles(files, { interactive: false });           // never block a scan on the "Which system?" picker
      for (const k of ['added', 'dup', 'skipped', 'needChoice']) res[k] += r[k] || 0;
      res.problems.push(...(r.problems || [])); res.newRoms.push(...(r.newRoms || []));
      if (!r.needChoice && !(r.problems || []).length) for (const e of g) seen[e.path] = sig(e);
    } catch (err) {
      res.skipped++; res.problems.push(`“${g[0].name}”: ${err.message || err}`);
      if (err && err.name === 'QuotaExceededError') break;
    }
  }
  folder.seen = seen; folder.lastScan = Date.now(); folder.fileCount = entries.length; folder.lastAdded = res.added;
  await db.putFolder(folder).catch((e) => console.warn('folder save', e));
  return res;
}

/** Re-scans a remembered folder (saf / fsa). Throws {code:'permission'} when access has to be granted again with a tap. */
export async function scanFolder(folder, opts) {
  const onProgress = opts.onProgress || (() => {});
  const access = await folderAccess(folder, { request: !!opts.interactive });
  if (access !== 'granted') { const e = new Error(access === 'repick' ? 'Pick the files again to scan (iOS has no lasting folder access)' : 'Folder access needs to be allowed again'); e.code = access === 'repick' ? 'repick' : 'permission'; throw e; }
  const entries = folder.kind === 'saf' ? await listSaf(folder, onProgress) : await listFsa(folder.handle, onProgress);
  return scanEntries(folder, entries, opts);
}

/** iOS / fallback: scans a picked FileList (multi-select or webkitdirectory) and records it as a remembered import source. */
export async function importPicked(files, { label = 'Downloads', ...opts } = {}) {
  const id = 'import:' + label.toLowerCase();
  const folder = (await db.allFolders().catch(() => [])).find((f) => f.id === id) || { id, kind: 'import', name: label, added: Date.now(), lastScan: 0, fileCount: 0, lastAdded: 0, seen: {} };
  return scanEntries(folder, listFiles(files), opts);
}

/** Auto-scan on launch: every remembered folder whose permission is still granted (APK always, Chrome when it persisted). */
export async function autoScan(opts) {
  const total = { added: 0, folders: 0, newRoms: [] };
  for (const f of await listFolders()) {
    if (f.kind === 'import') continue;
    if (await folderAccess(f) !== 'granted') continue;
    try { const r = await scanFolder(f, { ...opts, interactive: false }); total.added += r.added; total.newRoms.push(...r.newRoms); total.folders++; }
    catch (e) { console.warn('auto-scan', f.name, e); }
  }
  return total;
}

export const _test = { scanEntries, listFiles, libraryKeys };

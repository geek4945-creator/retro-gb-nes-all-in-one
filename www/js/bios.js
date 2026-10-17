// BIOS / firmware files: stored by the user in IndexedDB (NEVER bundled with the app) and handed to EmulatorJS at launch.
import * as db from './db.js';
import { SYSTEMS } from './cores.js';
import { storedZip, unzipEntries } from './detect.js';
import { md5 } from './hash.js';
import { OPEN_FILES } from './biosdata.js';

export const biosKey = (system) => ((SYSTEMS[system] || {}).biosFrom) || system;
export const biosSpec = (system) => ((SYSTEMS[biosKey(system)] || {}).bios) || null;
export const biosSystems = () => Object.keys(SYSTEMS).filter((k) => SYSTEMS[k].bios);

/** Map an uploaded file name onto the exact (case-sensitive) name a core looks for, when it differs only by case/copy suffix. */
export function canonicalName(system, name) {
  const spec = biosSpec(system); if (!spec) return name;
  const clean = name.replace(/ \(\d+\)(?=\.[^.]+$)/, '');
  const hit = spec.files.find((x) => x.name.toLowerCase() === clean.toLowerCase());
  return hit ? hit.name : clean;
}
export const isExpected = (system, name) => !!(biosSpec(system) && biosSpec(system).files.some((x) => x.name === name));

/** Save uploaded files for a system (unpacking .zip BIOS packs for extract-mode systems). Returns { saved:[names], unknown:[names] }. */
export async function saveBiosFiles(system, files, extra = {}) {
  const key = biosKey(system), spec = biosSpec(key), saved = [], unknown = [];
  const put = async (name, data) => {
    name = canonicalName(key, name);
    await db.putBios({ id: `${key}/${name}`, system: key, name, size: data.byteLength, data: data.buffer ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) : data, time: Date.now(), ...(extra[name] || {}) });
    saved.push(name); if (!isExpected(key, name)) unknown.push(name);
  };
  for (const f of files) {
    if (spec.mode === 'extract' && /\.zip$/i.test(f.name)) {
      const want = (n) => isExpected(key, canonicalName(key, n.split('/').pop()));
      const inner = await unzipEntries(f, want).catch(() => []);
      if (inner.length) { for (const e of inner) await put(e.name, e.data); continue; }
    }
    await put(f.name, new Uint8Array(await f.arrayBuffer()));
  }
  return { saved, unknown };
}

/** { have:[names], needs:bool } - `needs` when the system has required BIOS files and none of them is stored. */
export async function biosStatus(system) {
  const spec = biosSpec(system); if (!spec) return { spec: null, have: [], needs: false };
  const have = (await db.biosFor(biosKey(system))).map((b) => b.name);
  const req = spec.files.filter((x) => x.level === 'required');
  return { spec, have, needs: req.length > 0 && !req.some((x) => have.includes(x.name)) };
}

/**
 * What to hand to EmulatorJS for this system: { file, names } or null when the user stored no BIOS.
 * EmulatorJS unpacks the BIOS archive into the emulator's root directory (where cores look for BIOS files). We always send a stored ZIP
 * of the user's files; files that must stay zipped (Neo Geo `neogeo.zip`, CD-i `cdimono1.zip`) simply travel as an inner ZIP, which
 * EmulatorJS leaves untouched. EmulatorJS only accepts a URL string for BIOS, so the player passes a blob: URL.
 */
export async function buildBios(system) {
  const spec = biosSpec(system); if (!spec) return null;
  const stored = await db.biosFor(biosKey(system)); if (!stored.length) return null;
  const zip = await storedZip(stored.map((b) => ({ name: b.name, data: new Uint8Array(b.data) })));
  return { file: new File([zip], 'bios.zip', { type: 'application/zip' }), names: stored.map((b) => b.name) };
}

/**
 * Per-file report for the BIOS dialog: every file the system looks for (plus anything else stored), with whether it is installed and
 * whether its md5 matches the checksum libretro publishes. verdict: 'ok' (md5 matches) | 'differs' (stored, md5 differs - may still work)
 * | 'unknown' (stored, no reference md5) | 'missing'.
 */
export async function biosReport(system) {
  const key = biosKey(system), spec = biosSpec(key); if (!spec) return null;
  const stored = await db.biosFor(key), byName = new Map(stored.map((b) => [b.name, b]));
  const row = (x) => {
    const b = byName.get(x.name);
    if (!b) return { ...x, stored: null, verdict: 'missing' };
    const actual = md5(new Uint8Array(b.data));
    return { ...x, stored: b, actual, verdict: x.md5 ? (actual === x.md5 ? 'ok' : (b.open ? 'open' : 'differs')) : (b.open ? 'open' : 'unknown') };
  };
  const files = spec.files.map(row);
  const extras = stored.filter((b) => !spec.files.some((x) => x.name === b.name)).map((b) => ({ name: b.name, level: 'optional', note: 'not a name this system looks for', md5: '', stored: b, actual: md5(new Uint8Array(b.data)), verdict: 'unknown' }));
  return { key, spec, files: [...files, ...extras], open: openFilesFor(key) };
}

// ---------------------------------------------------------------- downloads of the open-licensed files (see biosdata.js)
export const openFilesFor = (system) => OPEN_FILES.filter((o) => biosKey(o.system) === biosKey(system));
export const allOpenFiles = () => OPEN_FILES.slice();

async function readBody(res, onChunk) {
  if (!res.body || !res.body.getReader) { const b = new Uint8Array(await res.arrayBuffer()); onChunk(b.length); return b; }
  const reader = res.body.getReader(), parts = []; let n = 0;
  for (;;) { const { done, value } = await reader.read(); if (done) break; parts.push(value); n += value.length; onChunk(value.length); }
  const out = new Uint8Array(n); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

/**
 * Download open-licensed BIOS files into IndexedDB (same store the uploader uses), verifying size and md5 against biosdata.js first.
 * `files` = entries of OPEN_FILES. A failed / corrupt download is never stored. Returns { saved:[names], failed:[{name,error}] }.
 * opts: { fetchFn (default fetch), base (default document URL), onProgress({file, loaded, total, done, count, index}) }.
 */
export async function downloadOpen(files, opts = {}) {
  const fetchFn = opts.fetchFn || ((...a) => fetch(...a)), base = opts.base || (typeof location !== 'undefined' ? location.href : 'http://localhost/');
  const total = files.reduce((n, o) => n + o.size, 0), saved = [], failed = [];
  let loaded = 0;
  const report = (file, index) => opts.onProgress && opts.onProgress({ file, loaded, total, count: files.length, index });
  for (let i = 0; i < files.length; i++) {
    const o = files[i], before = loaded;
    try {
      report(o, i);
      const res = await fetchFn(new URL(o.url, base).href, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await readBody(res, (n) => { loaded += n; report(o, i); });
      if (data.length !== o.size) throw new Error(`size ${data.length} B, expected ${o.size} B`);
      const sum = md5(data);
      if (sum !== o.md5) throw new Error(`checksum mismatch (got ${sum}, expected ${o.md5})`);
      await saveBiosFiles(o.system, [new File([data], o.name)], { [o.name]: { open: true, md5: sum, license: o.license, source: o.source } });
      saved.push(o.name);
    } catch (e) {
      loaded = before + o.size; failed.push({ name: o.name, system: o.system, error: e.message || String(e) });
    }
    report(o, i + 1);
  }
  return { saved, failed };
}

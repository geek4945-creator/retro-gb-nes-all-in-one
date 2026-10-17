// BIOS / firmware files: stored by the user in IndexedDB (NEVER bundled with the app) and handed to EmulatorJS at launch.
import * as db from './db.js';
import { SYSTEMS } from './cores.js';
import { storedZip, unzipEntries } from './detect.js';

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
export async function saveBiosFiles(system, files) {
  const key = biosKey(system), spec = biosSpec(key), saved = [], unknown = [];
  const put = async (name, data) => {
    name = canonicalName(key, name);
    await db.putBios({ id: `${key}/${name}`, system: key, name, size: data.byteLength, data: data.buffer ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) : data, time: Date.now() });
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

/** What to hand to EmulatorJS for this system: { file, raw } or null when the user stored no BIOS. */
export async function buildBios(system) {
  const spec = biosSpec(system); if (!spec) return null;
  const stored = await db.biosFor(biosKey(system)); if (!stored.length) return null;
  if (spec.mode === 'raw') { const b = stored[0]; return { file: new File([b.data], b.name), raw: true, names: [b.name] }; }
  const zip = await storedZip(stored.map((b) => ({ name: b.name, data: new Uint8Array(b.data) })));
  return { file: new File([zip], 'bios.zip', { type: 'application/zip' }), raw: false, names: stored.map((b) => b.name) };
}

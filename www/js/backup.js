// Backup & restore of everything that lives on this device: library (game files), save states, cover art, BIOS files and settings.
// One ZIP (stored, uncompressed) with a manifest. Needed because uninstalling the app / clearing site data deletes the browser storage.
import * as db from './db.js';
import { storedZip, unzipEntries } from './detect.js';

const STORES = ['roms', 'states', 'art', 'bios'];                 // 'meta' is only a cache of thumbnail name indexes
const SKIP_LS = new Set(['rp.hintDismissed', 'rp.keys']);          // rp.keys holds the user's own API keys: never written into a backup file
const isBin = (v) => v instanceof ArrayBuffer || ArrayBuffer.isView(v) || v instanceof Blob;
const enc = encodeURIComponent;

export async function exportBackup({ includeGames = true, onProgress = () => {} } = {}) {
  const entries = [], manifest = { app: 'retro-pocket', format: 1, created: new Date().toISOString(), includeGames, records: [], localStorage: {} };
  for (const store of STORES) {
    const keys = await db.keysRaw(store);
    for (const key of keys) {
      if (store === 'roms' && !includeGames) { const rec = await db.getRaw(store, key); manifest.records.push({ store, rec: { ...rec, data: undefined }, bin: {}, metaOnly: true }); continue; }
      const rec = await db.getRaw(store, key), bin = {}, plain = {};
      for (const [f, v] of Object.entries(rec)) {
        if (isBin(v)) { const name = `${store}__${enc(String(key))}__${f}`; bin[f] = { entry: name, kind: v instanceof Blob ? 'blob' : (ArrayBuffer.isView(v) ? 'view' : 'ab'), type: v.type || '' }; entries.push({ name, data: v instanceof Blob ? v : (ArrayBuffer.isView(v) ? new Blob([v]) : new Blob([v])) }); }
        else plain[f] = v;
      }
      manifest.records.push({ store, rec: plain, bin }); onProgress(store, manifest.records.length);
    }
  }
  for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k.startsWith('rp.') && !SKIP_LS.has(k)) manifest.localStorage[k] = localStorage.getItem(k); }
  entries.unshift({ name: 'manifest.json', data: new Blob([JSON.stringify(manifest)], { type: 'application/json' }) });
  return storedZip(entries);
}

export async function importBackup(file, { onProgress = () => {} } = {}) {
  const files = await unzipEntries(file), byName = new Map(files.map((f) => [f.name, f.data]));
  const mf = byName.get('manifest.json'); if (!mf) throw new Error('Not a Retro Pocket backup (manifest.json missing)');
  const manifest = JSON.parse(new TextDecoder().decode(mf)); if (manifest.app !== 'retro-pocket') throw new Error('Not a Retro Pocket backup');
  const counts = { roms: 0, states: 0, art: 0, bios: 0, skipped: 0 };
  for (const r of manifest.records) {
    if (!STORES.includes(r.store)) continue;
    const rec = { ...r.rec };
    if (r.metaOnly) { counts.skipped++; continue; }                // library entry without game file (backup made without games): not restorable
    let ok = true;
    for (const [f, b] of Object.entries(r.bin)) {
      const u8 = byName.get(b.entry); if (!u8) { ok = false; break; }
      rec[f] = b.kind === 'blob' ? new Blob([u8], { type: b.type }) : b.kind === 'view' ? u8 : u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
    }
    if (!ok) { counts.skipped++; continue; }
    await db.putRaw(r.store, rec); counts[r.store]++; onProgress(r.store, counts[r.store]);
  }
  for (const [k, v] of Object.entries(manifest.localStorage || {})) if (k.startsWith('rp.') && !SKIP_LS.has(k)) localStorage.setItem(k, v);
  return counts;
}

const el = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); for (const k of kids) e.append(k); return e; };
export function openBackup(dlg, toast) {
  const status = el('p', { className: 'muted small', id: 'bk-status', textContent: '' });
  const games = el('input', { type: 'checkbox', id: 'bk-games', checked: true });
  const pick = el('input', { type: 'file', accept: '.zip,application/zip', id: 'bk-file', hidden: true });
  const stamp = () => new Date().toISOString().slice(0, 10);
  dlg.replaceChildren(
    el('h3', { textContent: 'Backup & restore' }),
    el('p', { className: 'muted small', textContent: 'Your games, save states, cover art, BIOS files and settings live only in this app’s storage on this device. Uninstalling the app (or clearing site data) deletes them. Export a backup file first and import it afterwards.' }),
    el('label', { className: 'row select' }, 'Include game files (large)', games),
    el('button', { className: 'row primary', id: 'bk-export', textContent: '⬆ Export backup…', onclick: async () => {
      status.textContent = 'Building backup…';
      try {
        const blob = await exportBackup({ includeGames: games.checked, onProgress: (s, n) => { status.textContent = `Reading ${s}… (${n})`; } });
        const f = new File([blob], `retro-pocket-backup-${stamp()}.zip`, { type: 'application/zip' });
        if (navigator.canShare && navigator.canShare({ files: [f] })) { try { await navigator.share({ files: [f], title: 'Retro Pocket backup' }); status.textContent = 'Backup shared/saved.'; return; } catch (e) { if (e && e.name === 'AbortError') { status.textContent = 'Cancelled.'; return; } } }
        const a = el('a', { href: URL.createObjectURL(f), download: f.name }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 60000);
        status.textContent = `Backup created (${(f.size / 1048576).toFixed(1)} MB). If nothing was saved (some Android app WebViews cannot download files), export from the web app in Chrome instead.`;
      } catch (e) { status.textContent = 'Export failed: ' + e.message; }
    } }),
    el('button', { className: 'row', id: 'bk-import', textContent: '⬇ Import backup…', onclick: () => pick.click() }),
    pick, status,
    el('button', { className: 'row ghost', textContent: 'Back', onclick: () => { dlg.close(); document.getElementById('btn-settings').click(); } }));
  pick.onchange = async () => {
    const f = pick.files[0]; if (!f) return; status.textContent = 'Importing…';
    try { const c = await importBackup(f, { onProgress: (s, n) => { status.textContent = `Restoring ${s}… (${n})`; } }); status.textContent = `Restored ${c.roms} games, ${c.states} states, ${c.art} covers, ${c.bios} BIOS files${c.skipped ? ` (${c.skipped} skipped)` : ''}. Reloading…`; setTimeout(() => location.reload(), 900); }
    catch (e) { status.textContent = 'Import failed: ' + e.message; }
  };
  if (!dlg.open) dlg.showModal();
}

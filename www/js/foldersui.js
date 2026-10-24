// Library "Scan for new ROMs" / "Scan Downloads" buttons + Settings -> ROM folders dialog.
import { folderMode, listFolders, addFolder, removeFolder, scanFolder, importPicked, folderAccess, autoScan, dirPickerSupported } from './folders.js';

const $ = (s) => document.querySelector(s);
const el = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); for (const k of kids) if (k != null) e.append(k); return e; };
const ago = (t) => { if (!t) return 'never'; const s = (Date.now() - t) / 1000; if (s < 60) return 'just now'; if (s < 3600) return `${Math.round(s / 60)} min ago`; if (s < 86400) return `${Math.round(s / 3600)} h ago`; return new Date(t).toLocaleDateString(); };
export const IOS_HOWTO = 'Tap “Browse” → “Downloads” → “Select” (top right) → “Select All” → “Open”. Only new games are added; other files are skipped.';

let deps, busy = false;
function progress(msg, frac) {
  const p = $('#scan-progress'); if (!p) return;
  if (msg == null) { p.hidden = true; return; }
  p.hidden = false; p.querySelector('span').textContent = msg;
  p.querySelector('i').style.width = frac == null ? '100%' : Math.round(frac * 100) + '%';
  p.classList.toggle('indet', frac == null);
  const d = $('#fd-progress'); if (d) d.textContent = msg;
}
async function run(label, fn) {
  if (busy) { deps.toast('A scan is already running…'); return null; }
  busy = true; progress(label);
  try {
    const r = await fn((m, f) => progress(m, f));
    await deps.refresh();
    return r;
  } catch (e) {
    console.warn(e); deps.toast(e.message || String(e), { sticky: 5000 }); return null;
  } finally { busy = false; progress(null); if ($('#folders').open) drawFolders(); }
}
const common = () => ({ importFiles: deps.importFiles, getRoms: deps.getRoms });

async function scanAll({ interactive = true } = {}) {
  const folders = (await listFolders()).filter((f) => f.kind !== 'import');
  if (!folders.length) return addAndScan();
  const tot = { added: 0, dup: 0, skipped: 0, needChoice: 0, problems: [], newRoms: [] };
  const r = await run('Scanning ROM folders…', async (onProgress) => {
    for (const f of folders) {
      try {
        const x = await scanFolder(f, { ...common(), interactive, onProgress: (m, fr) => onProgress(`${f.name}: ${m}`, fr) });
        for (const k of ['added', 'dup', 'skipped', 'needChoice']) tot[k] += x[k]; tot.problems.push(...x.problems); tot.newRoms.push(...x.newRoms);
      } catch (e) { tot.problems.push(`${f.name}: ${e.message}`); }
    }
    return tot;
  });
  if (r) deps.report(r);
}
export async function scanOne(f) {
  const r = await run(`Scanning ${f.name}…`, (onProgress) => scanFolder(f, { ...common(), interactive: true, onProgress }));
  if (r) deps.report(r, { prefix: `${f.name}: ` });
}
async function addAndScan() {
  let f;
  try { f = await addFolder(); } catch (e) { deps.toast('Could not open the folder picker: ' + (e.message || e), { sticky: 5000 }); return; }
  if (!f) return;
  if ($('#folders').open) drawFolders();
  await scanOne(f);
}
async function onPicked(files, label) {
  if (!files.length) return;
  const r = await run(`Checking ${files.length} file${files.length > 1 ? 's' : ''}…`, (onProgress) => importPicked(files, { ...common(), label, interactive: false, onProgress }));
  if (r) deps.report({ ...r, problems: r.problems }, { prefix: r.nonRom ? `${r.nonRom} non-game file${r.nonRom > 1 ? 's' : ''} ignored · ` : '' });
}

export async function drawFolders() {
  const d = $('#folders'), mode = folderMode(), folders = await listFolders();
  const rows = folders.map((f) => {
    const kindTxt = f.kind === 'saf' ? 'Android folder' : f.kind === 'fsa' ? 'Folder' : 'Imported (re-pick to scan)';
    const info = el('span', { className: 'muted small', textContent: `${kindTxt} · ${f.fileCount || 0} ROM file${f.fileCount === 1 ? '' : 's'} · last scanned ${ago(f.lastScan)}${f.lastScan ? ` · ${f.lastAdded || 0} new` : ''}` });
    const acc = el('span', { className: 'small warn-txt' });
    if (f.kind !== 'import') folderAccess(f).then((a) => { if (a !== 'granted') acc.textContent = ' · access must be allowed again (tap Rescan)'; });
    const rescan = f.kind === 'import'
      ? el('button', { className: 'chip', textContent: 'Re-pick', onclick: () => (f.id === 'import:downloads' ? $('#pick-downloads') : $('#pick-dir')).click() })
      : el('button', { className: 'chip', textContent: 'Rescan', onclick: () => scanOne(f) });
    return el('div', { className: 'row folder-row', title: f.name },
      el('div', { className: 'folder-info' }, el('b', { textContent: '📁 ' + f.name }), el('br'), info, acc),
      el('div', { className: 'folder-btns' }, rescan,
        el('button', { className: 'chip', textContent: 'Remove', onclick: async () => { if (!confirm(`Forget “${f.name}”? Games already added stay in the library.`)) return; await removeFolder(f); drawFolders(); } })));
  });
  const intro = mode === 'saf' ? 'Pick folders on your phone (the first suggestion is Download/). Retro Pocket keeps read access, scans them on every launch and adds only new games.'
    : mode === 'fsa' ? 'Pick folders on this device. Chrome remembers them; if it asks again, tap Rescan to allow access. Remembered folders are scanned on launch when access is still allowed.'
      : 'This browser (iPhone/iPad Safari, Firefox) cannot keep access to a folder, so pick the files again whenever you want to scan. Duplicates are skipped automatically.';
  d.replaceChildren(
    el('h3', { textContent: 'ROM folders' }),
    el('p', { className: 'muted small', textContent: intro }),
    ...(mode === 'import' ? [
      el('button', { className: 'row primary', id: 'fd-downloads', textContent: '📥 Scan Downloads', onclick: () => $('#pick-downloads').click() }),
      el('p', { className: 'muted small howto', textContent: IOS_HOWTO }),
      ...(dirPickerSupported() ? [el('button', { className: 'row', id: 'fd-importdir', textContent: '📁 Import a whole folder…', onclick: () => $('#pick-dir').click() })] : []),
    ] : [
      el('button', { className: 'row primary', id: 'fd-add', textContent: '＋ Add ROM folder…', onclick: addAndScan }),
      ...(folders.some((f) => f.kind !== 'import') ? [el('button', { className: 'row', id: 'fd-scanall', textContent: '🔄 Scan all for new ROMs', onclick: () => scanAll() })] : []),
    ]),
    ...(rows.length ? rows : [el('p', { className: 'muted small', textContent: 'No folders yet.' })]),
    el('p', { className: 'muted small', id: 'fd-progress' }),
    el('p', { className: 'muted small', textContent: 'Handles .zip, .cue/.bin, .m3u and every supported ROM extension; pictures, saves, text and other files are skipped. Games are copied into the app (so they keep working offline); “Add games” still picks single files.' }),
    el('button', { className: 'row ghost', textContent: 'Close', onclick: () => d.close() }));
  if (!d.open) d.showModal();
}

export function initFolders(d) {
  deps = d;
  const mode = folderMode();
  const scanBtn = $('#btn-scan');
  if (mode === 'import') {
    scanBtn.textContent = '📥 Scan Downloads';
    $('#scan-howto').textContent = IOS_HOWTO; $('#scan-howto').hidden = false;
    scanBtn.onclick = () => $('#pick-downloads').click();
  } else scanBtn.onclick = () => scanAll();
  $('#btn-folders').onclick = () => drawFolders();
  $('#pick-downloads').addEventListener('change', (e) => { const f = [...e.target.files]; e.target.value = ''; onPicked(f, 'Downloads'); });
  $('#pick-dir').addEventListener('change', (e) => {
    const f = [...e.target.files]; e.target.value = '';
    const top = f[0] && f[0].webkitRelativePath ? f[0].webkitRelativePath.split('/')[0] : 'Folder';
    onPicked(f, top);
  });
  if (mode !== 'import') setTimeout(async () => {
    if (busy) return; busy = true;
    try {
      const r = await autoScan({ ...common(), onProgress: (m, f) => progress('Checking ROM folders… ' + m, f) });
      if (r.added) { await deps.refresh(); deps.report({ added: r.added, newRoms: r.newRoms }, { prefix: '📁 ' }); }
    } catch (e) { console.warn(e); } finally { busy = false; progress(null); }
  }, 600);
}
export { scanAll };

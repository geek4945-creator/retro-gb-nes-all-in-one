import { SYSTEMS, CORE_LABELS, systemFor, titleFrom, defaultCore, loadSettings, saveSettings, extOf } from './cores.js';
import * as db from './db.js';
import { fetchArt, artUrl } from './art.js';
import { openCoverPicker } from './cover.js';
import { openControllers } from './padsui.js';
import { startPadNav } from './padnav.js';
import { rawPads, padName } from './pads.js';

const $ = (s) => document.querySelector(s);
const el = (tag, props = {}, ...kids) => {
  const e = Object.assign(document.createElement(tag), props);
  for (const k of kids) e.append(k);
  return e;
};
const MAX_ROM = 64 * 1024 * 1024;
let roms = [], artMap = new Map(), artUrls = new Map(), resumable = new Set(), filter = 'all', query = '', settings = loadSettings();

/* ---------- toast ---------- */
let toastTimer;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), 3200);
}

/* ---------- library ---------- */
async function refresh() {
  roms = (await db.allRoms()).sort((a, b) => (b.lastPlayed || b.added) - (a.lastPlayed || a.added));
  resumable = new Set(await db.allStateIds());
  artMap = new Map((await db.allArt().catch(() => [])).map((a) => [a.id, a]));
  render();
}

function render() {
  const chips = $('#chips'); chips.replaceChildren();
  const present = ['all', ...Object.keys(SYSTEMS).filter((k) => roms.some((r) => r.system === k))];
  if (!present.includes(filter)) filter = 'all';
  for (const k of present) {
    chips.append(el('button', {
      className: 'chip' + (filter === k ? ' on' : ''), type: 'button',
      textContent: k === 'all' ? 'All' : SYSTEMS[k].short,
      onclick: () => { filter = k; render(); },
    }));
  }
  chips.hidden = roms.length === 0;
  $('#search').hidden = roms.length === 0;

  const q = query.trim().toLowerCase();
  const list = roms.filter((r) => (filter === 'all' || r.system === filter) && (!q || r.title.toLowerCase().includes(q)));
  for (const u of artUrls.values()) if (u.startsWith('blob:')) URL.revokeObjectURL(u);
  artUrls.clear();
  const missing = roms.filter((r) => !artMap.has(r.id) || artMap.get(r.id).status === 'none').length;
  const ab = $('#btn-art'); ab.hidden = !missing; ab.textContent = `🖼 Get art (${missing})`;
  const grid = $('#library'); grid.replaceChildren();
  $('#empty').hidden = roms.length !== 0;
  for (const r of list) grid.append(card(r));
  if (roms.length && !list.length) grid.append(el('p', { className: 'muted center', textContent: 'No matches.' }));
}

function hue(str) { let h = 0; for (const c of str) h = (h * 31 + c.charCodeAt(0)) % 360; return h; }

function card(r) {
  const sys = SYSTEMS[r.system] || SYSTEMS.gb;
  const h = hue(r.title);
  const art = el('div', { className: 'art' },
    el('span', { className: 'ph-title', textContent: r.title }),     // generated placeholder cover: system colour + title
    el('span', { className: 'badge', textContent: sys.short }));
  art.style.background = `linear-gradient(150deg, ${sys.color}, hsl(${h} 45% 18%) 75%)`;
  const url = artUrl(artMap.get(r.id));
  if (url) {
    artUrls.set(r.id, url);
    const img = el('img', { className: 'cover', src: url, alt: '', loading: 'lazy', decoding: 'async', referrerPolicy: 'no-referrer' });
    img.onerror = () => { img.remove(); art.classList.remove('has-img'); };   // offline remote art etc. -> generated placeholder stays visible
    art.classList.add('has-img'); art.prepend(img);
  }
  if (resumable.has(r.id)) art.append(el('span', { className: 'resume', textContent: '▶ Resume' }));
  const c = el('div', { className: 'card', role: 'button', tabIndex: 0 }, art,
    el('div', { className: 'meta' }, el('span', { className: 'name', textContent: r.title }),
      el('button', { className: 'more', type: 'button', ariaLabel: 'Options for ' + r.title, textContent: '⋯', onclick: (e) => { e.stopPropagation(); openSheet(r); } })));
  const go = () => play(r, settings.autoResume && resumable.has(r.id));
  c.onclick = go;
  c.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } };
  return c;
}

function play(r, resume) {
  location.href = `player.html?id=${encodeURIComponent(r.id)}${resume ? '&resume=1' : ''}`;
}

/* ---------- box art ---------- */
let artBusy = false;
async function fetchMissingArt(list, { quiet = false, force = false } = {}) {
  if (artBusy) return; artBusy = true;
  try {
    let done = 0, got = 0;
    for (const r of list) {
      const prev = artMap.get(r.id);
      if (!force && prev && prev.status !== 'none') continue;
      if (prev && prev.custom && !force) continue;
      if (!quiet || list.length > 1) toast(`Fetching cover art… ${done + 1}/${list.length}`);
      const rec = await fetchArt(r, { force });
      artMap.set(r.id, rec); if (rec.status !== 'none') got++; done++;
      render();
    }
    if (!quiet || got) toast(done ? `Cover art: found ${got} of ${done}` : 'Nothing to fetch');
  } finally { artBusy = false; }
}
$('#btn-art').onclick = () => {
  if (!navigator.onLine) return toast('You are offline — art needs internet once.');
  fetchMissingArt(roms.filter((r) => !artMap.has(r.id) || artMap.get(r.id).status === 'none'));
};

/* ---------- adding ROMs ---------- */
function askSystem(filename) {
  return new Promise((resolve) => {
    const d = $('#sheet'); d.replaceChildren(
      el('h3', { textContent: 'Which system is this?' }),
      el('p', { className: 'muted', textContent: `“${filename}” has an unrecognised extension.` }),
      ...Object.entries(SYSTEMS).map(([k, s]) => el('button', { className: 'row', textContent: s.label, onclick: () => { d.onclose = null; d.close(); resolve(k); } })),
      el('button', { className: 'row ghost', textContent: 'Skip this file', onclick: () => d.close() }));
    d.onclose = () => resolve(null);
    d.showModal();
  });
}

async function addFiles(files) {
  let added = 0, dup = 0, skipped = 0; const newRoms = [];
  for (const f of files) {
    try {
      if (f.size > MAX_ROM) { skipped++; continue; }
      let system = systemFor(f.name), fname = f.name;
      if (!system) {
        system = await askSystem(f.name);
        if (!system) { skipped++; continue; }
        const ext = { gb: 'gb', gbc: 'gbc', gba: 'gba', nes: 'nes', snes: 'sfc', nds: 'nds' }[system];
        if (extOf(f.name) !== 'zip') fname = f.name.replace(/\.[^.]*$/, '') + '.' + ext;
      }
      const data = await f.arrayBuffer();
      const id = await db.sha256Hex(data);
      if (await db.getRom(id)) { dup++; continue; }
      await db.putRom({
        id, file: fname, title: titleFrom(f.name), system, core: defaultCore(system, settings),
        size: data.byteLength, added: Date.now(), lastPlayed: 0, data,
      });
      added++; newRoms.push(id);
    } catch (e) {
      console.error(e); skipped++;
      if (e && e.name === 'QuotaExceededError') { toast('Storage is full — free up space and try again.'); break; }
    }
  }
  await refresh();
  const parts = [];
  if (added) parts.push(`Added ${added} game${added > 1 ? 's' : ''}`);
  if (dup) parts.push(`${dup} already in library`);
  if (skipped) parts.push(`${skipped} skipped`);
  if (parts.length) toast(parts.join(' · '));
  if (newRoms.length) fetchMissingArt(roms.filter((r) => newRoms.includes(r.id)), { quiet: true });
}

$('#file-input').addEventListener('change', async (e) => {
  const files = [...e.target.files]; e.target.value = '';
  if (files.length) await addFiles(files);
});
let dragDepth = 0;
addEventListener('dragenter', (e) => { e.preventDefault(); dragDepth++; $('#drop').hidden = false; });
addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; $('#drop').hidden = true; } });
addEventListener('dragover', (e) => e.preventDefault());
addEventListener('drop', async (e) => {
  e.preventDefault(); dragDepth = 0; $('#drop').hidden = true;
  if (e.dataTransfer.files.length) await addFiles([...e.dataTransfer.files]);
});

/* ---------- per-game sheet ---------- */
function openSheet(r) {
  const d = $('#sheet'); d.onclose = null;
  const sys = SYSTEMS[r.system];
  const coreSel = el('select', { onchange: async () => { r.core = coreSel.value; await db.putRom(r); await db.deleteState(r.id).catch(() => {}); resumable.delete(r.id); toast('Core set to ' + r.core + ' (auto-resume snapshot cleared)'); } },
    ...sys.cores.map((c) => el('option', { value: c, textContent: CORE_LABELS[c] || c, selected: c === r.core })));
  const rows = [
    el('h3', { textContent: r.title }),
    el('p', { className: 'muted', textContent: `${sys.label} · ${(r.size / 1024).toFixed(0)} KB · ${r.file}` }),
    el('button', { className: 'row primary', textContent: resumable.has(r.id) ? '▶ Resume where you left off' : '▶ Play', onclick: () => play(r, resumable.has(r.id)) }),
  ];
  if (resumable.has(r.id)) {
    rows.push(el('button', { className: 'row', textContent: '↻ Start from the beginning', onclick: async () => { await db.deleteState(r.id); play(r, false); } }));
  }
  rows.push(el('button', { className: 'row', textContent: '🖼 Change cover…', onclick: () => {
    d.close();
    openCoverPicker(r, { onSaved: async (res) => {
      if (res.reset) { artMap.delete(r.id); await refresh(); if (navigator.onLine) await fetchMissingArt([r], { force: true }); return; }
      await refresh(); toast('Cover updated');
    } });
  } }));
  rows.push(el('button', { className: 'row', textContent: '🖼 Refresh cover art (automatic)', onclick: async () => {
    d.close(); if (!navigator.onLine) return toast('You are offline — art needs internet.');
    artMap.delete(r.id); await db.deleteArt(r.id).catch(() => {}); await fetchMissingArt([r], { force: true });
  } }));
  if (r.system === 'nds') rows.push(el('p', { className: 'muted small', textContent: 'Nintendo DS is demanding: expect slow speed on older phones and on iPhone Safari. DeSmuME 2015 is the lighter core.' }));
  if (sys.cores.length > 1) rows.push(el('label', { className: 'row select' }, 'Emulator core', coreSel));
  rows.push(
    el('button', { className: 'row', textContent: 'Rename', onclick: async () => {
      const n = prompt('Game title', r.title);
      if (n && n.trim()) { r.title = n.trim(); await db.putRom(r); d.close(); await refresh(); }
    } }),
    el('button', { className: 'row danger', textContent: 'Remove from library', onclick: async () => {
      if (!confirm(`Remove “${r.title}” from this device?\nIn-game saves may also be lost.`)) return;
      await db.deleteRom(r.id); await db.deleteState(r.id); await db.deleteArt(r.id).catch(() => {}); d.close(); await refresh(); toast('Removed');
    } }),
    el('button', { className: 'row ghost', textContent: 'Close', onclick: () => d.close() }));
  d.replaceChildren(...rows); d.showModal();
}
for (const dlg of document.querySelectorAll('dialog')) {
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
}

/* ---------- settings ---------- */
$('#btn-settings').onclick = async () => {
  const d = $('#settings');
  const mk = (label, key, opts) => el('label', { className: 'row select' }, label,
    el('select', { onchange: (e) => { settings[key] = e.target.value; saveSettings(settings); } },
      ...opts.map(([v, t]) => el('option', { value: v, textContent: t, selected: settings[key] === v }))));
  const est = navigator.storage && navigator.storage.estimate ? await navigator.storage.estimate().catch(() => null) : null;
  d.replaceChildren(
    el('h3', { textContent: 'Settings' }),
    mk('Default Game Boy core (new games)', 'gbCore', [['gambatte', 'Gambatte'], ['mgba', 'mGBA']]),
    mk('Default NES core (new games)', 'nesCore', [['nestopia', 'Nestopia (accurate, default)'], ['fceumm', 'FCEUmm (fast)']]),
    mk('Default Nintendo DS core (new games)', 'dsCore', [['desmume2015', 'DeSmuME 2015 (lighter)'], ['melonds', 'melonDS (accurate, heavy)']]),
    el('label', { className: 'row select' }, 'Auto-resume saved session',
      el('input', { type: 'checkbox', checked: !!settings.autoResume, onchange: (e) => { settings.autoResume = e.target.checked; saveSettings(settings); } })),
    el('button', { className: 'row', id: 'btn-controllers', textContent: '🎮 Controllers…', onclick: () => { d.close(); openControllers(); } }),
    el('button', { className: 'row', textContent: '🖼 Fetch all missing cover art', onclick: () => { d.close(); $('#btn-art').click(); } }),
    el('p', { className: 'muted', textContent: est && est.usage != null ? `Storage used: ${(est.usage / 1048576).toFixed(1)} MB` : '' }),
    el('p', { className: 'muted small', textContent: 'Retro Pocket runs RetroArch-based emulator cores (via EmulatorJS) entirely in your browser. Bring your own legally obtained ROMs — none are included. GPL-3.0.' }),
    el('button', { className: 'row ghost', textContent: 'Close', onclick: () => d.close() }));
  d.showModal();
};

/* ---------- misc ---------- */
$('#search').addEventListener('input', (e) => { query = e.target.value; render(); });

const isiOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = navigator.standalone || matchMedia('(display-mode: standalone)').matches || !!window.Capacitor;
if (isiOS && !standalone && !localStorage.getItem('rp.hintDismissed')) $('#install-hint').hidden = false;
$('#hint-close').onclick = () => { $('#install-hint').hidden = true; localStorage.setItem('rp.hintDismissed', '1'); };

if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW registration failed', e));
}
addEventListener('pageshow', (e) => { if (e.persisted) refresh(); });
refresh().catch((e) => { console.error(e); toast('Could not open local storage (private mode?).'); });

/* ---------- physical controllers: connect toasts + library navigation ---------- */
let padSig = '';
setInterval(() => {
  const pads = rawPads(), sig = pads.map((g) => g.id + '#' + g.index).join('|');
  if (sig === padSig) return;
  const had = padSig.split('|').filter(Boolean).length; padSig = sig;
  if (pads.length > had) toast(`🎮 ${padName(pads[pads.length - 1].id)} connected — D-pad to move, A to play`);
  else if (pads.length < had) toast('🎮 Controller disconnected');
}, 600);
const openDialog = () => [...document.querySelectorAll('dialog[open]')].pop();
const padNav = startPadNav({
  getFocusables: () => {
    const d = openDialog();
    if (d) return [...d.querySelectorAll('button:not([hidden]):not(:disabled), select, input[type=range], input[type=checkbox], summary, .cv-tile')];
    return [...document.querySelectorAll('#library .card')];
  },
  onBack: () => { const d = openDialog(); if (d) d.close(); },
  onStart: () => { if (openDialog()) return; const c = document.activeElement; if (c && c.classList && c.classList.contains('card')) c.querySelector('.more').click(); },
  onSelect: () => { if (!openDialog()) $('#btn-settings').click(); },
  onL: () => cycleChip(-1), onR: () => cycleChip(1),
  enabled: () => !location.hash.includes('nopad'),
});
function cycleChip(dir) {
  if (openDialog()) return;
  const chips = [...document.querySelectorAll('#chips .chip')]; if (chips.length < 2) return;
  const i = chips.findIndex((c) => c.classList.contains('on'));
  chips[(i + dir + chips.length) % chips.length].click();
  const first = document.querySelector('#library .card'); if (first) padNav.setFocus(first);
}
addEventListener('pointerdown', () => document.querySelectorAll('.pad-focus').forEach((x) => x.classList.remove('pad-focus')), { passive: true });

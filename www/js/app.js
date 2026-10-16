import { SYSTEMS, CORE_LABELS, systemFor, titleFrom, defaultCore, loadSettings, saveSettings, extOf } from './cores.js';
import * as db from './db.js';

const $ = (s) => document.querySelector(s);
const el = (tag, props = {}, ...kids) => {
  const e = Object.assign(document.createElement(tag), props);
  for (const k of kids) e.append(k);
  return e;
};
const MAX_ROM = 64 * 1024 * 1024;
let roms = [], resumable = new Set(), filter = 'all', query = '', settings = loadSettings();

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
    el('span', { className: 'initials', textContent: r.title.replace(/[^A-Za-z0-9 ]/g, '').split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('').toUpperCase() || '?' }),
    el('span', { className: 'badge', textContent: sys.short }));
  art.style.background = `linear-gradient(145deg, hsl(${h} 55% 38%), hsl(${(h + 50) % 360} 60% 22%))`;
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
  let added = 0, dup = 0, skipped = 0;
  for (const f of files) {
    try {
      if (f.size > MAX_ROM) { skipped++; continue; }
      let system = systemFor(f.name), fname = f.name;
      if (!system) {
        system = await askSystem(f.name);
        if (!system) { skipped++; continue; }
        const ext = { gb: 'gb', gbc: 'gbc', gba: 'gba', nes: 'nes', snes: 'sfc' }[system];
        if (extOf(f.name) !== 'zip') fname = f.name.replace(/\.[^.]*$/, '') + '.' + ext;
      }
      const data = await f.arrayBuffer();
      const id = await db.sha256Hex(data);
      if (await db.getRom(id)) { dup++; continue; }
      await db.putRom({
        id, file: fname, title: titleFrom(f.name), system, core: defaultCore(system, settings),
        size: data.byteLength, added: Date.now(), lastPlayed: 0, data,
      });
      added++;
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
  const coreSel = el('select', { onchange: async () => { r.core = coreSel.value; await db.putRom(r); toast('Core set to ' + r.core); } },
    ...sys.cores.map((c) => el('option', { value: c, textContent: CORE_LABELS[c] || c, selected: c === r.core })));
  const rows = [
    el('h3', { textContent: r.title }),
    el('p', { className: 'muted', textContent: `${sys.label} · ${(r.size / 1024).toFixed(0)} KB · ${r.file}` }),
    el('button', { className: 'row primary', textContent: resumable.has(r.id) ? '▶ Resume where you left off' : '▶ Play', onclick: () => play(r, resumable.has(r.id)) }),
  ];
  if (resumable.has(r.id)) {
    rows.push(el('button', { className: 'row', textContent: '↻ Start from the beginning', onclick: async () => { await db.deleteState(r.id); play(r, false); } }));
  }
  if (sys.cores.length > 1) rows.push(el('label', { className: 'row select' }, 'Emulator core', coreSel));
  rows.push(
    el('button', { className: 'row', textContent: 'Rename', onclick: async () => {
      const n = prompt('Game title', r.title);
      if (n && n.trim()) { r.title = n.trim(); await db.putRom(r); d.close(); await refresh(); }
    } }),
    el('button', { className: 'row danger', textContent: 'Remove from library', onclick: async () => {
      if (!confirm(`Remove “${r.title}” from this device?\nIn-game saves may also be lost.`)) return;
      await db.deleteRom(r.id); await db.deleteState(r.id); d.close(); await refresh(); toast('Removed');
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
    mk('Default NES core (new games)', 'nesCore', [['fceumm', 'FCEUmm (fast)'], ['nestopia', 'Nestopia (accurate)']]),
    el('label', { className: 'row select' }, 'Auto-resume saved session',
      el('input', { type: 'checkbox', checked: !!settings.autoResume, onchange: (e) => { settings.autoResume = e.target.checked; saveSettings(settings); } })),
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

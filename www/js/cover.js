// "Change cover" picker: multi-source cover search (all keyless + CORS-friendly so it works from static GitHub Pages),
// paste-a-URL, upload-from-device, crop to the 3:4 cover shape, resize, save to IndexedDB.
import * as db from './db.js';
import { SYSTEMS } from './cores.js';
import { cleanTitle, getIndex, searchNames, rawUrl, shrink } from './art.js';

const $ = (s, r = document) => r.querySelector(s);
const el = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); for (const k of kids) e.append(k); return e; };
const OUT_W = 300, OUT_H = 400, PRE_W = 240, PRE_H = 320;
const SYS_WORDS = /\b(nes|famicom|nintendo( 64| ds)?|entertainment system|super nintendo|snes|super famicom|game ?boy( color| advance)?|gbc|gba|gb|ds|nds|n64|playstation( portable)?|psx|ps1|psp|sega( cd| saturn| genesis| master system| game gear)?|genesis|mega drive|mega-cd|master system|game gear|saturn|32x|atari( 2600| 5200| 7800| lynx| jaguar)?|lynx|jaguar|neo geo( pocket( color)?)?|pc engine|turbografx(-16|-cd)?|wonderswan( color)?|virtual boy|3do|commodore( 64| amiga)?|c64|amiga|vic-20|zx spectrum|amstrad cpc|colecovision|dos|mame|arcade)\b/gi;
const WEIRD_PROXY = (u) => `https://images.weserv.nl/?url=${encodeURIComponent(u.replace(/^https?:\/\//, ''))}&w=600&output=jpg&q=85`;

export const getKeys = () => { try { return JSON.parse(localStorage.getItem('rp.keys') || '{}'); } catch { return {}; } };
const setKeys = (k) => localStorage.setItem('rp.keys', JSON.stringify(k));

/* ---------- sources ---------- */
const jget = async (url, opts) => { const r = await fetch(url, opts); if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); };

async function srcLibretro(rom, q) {
  const title = q.replace(SYS_WORDS, ' ').replace(/\s+/g, ' ').trim() || q;
  const out = [];
  for (const [kind, label] of [['Named_Boxarts', 'Box art'], ['Named_Titles', 'Title screen'], ['Named_Snaps', 'Screenshot']]) {
    const names = await getIndex(rom.system, kind).catch(() => null);
    if (!names) continue;
    for (const n of searchNames(names, title, kind === 'Named_Boxarts' ? 12 : 6)) out.push({ thumb: rawUrl(rom.system, kind, n), full: rawUrl(rom.system, kind, n), label: `${label}: ${n.replace(/\.png$/, '')}` });
  }
  if (!out.length && !(await getIndex(rom.system, 'Named_Boxarts').catch(() => null))) throw new Error('listing unavailable (offline or GitHub rate limit)');
  return out;
}
async function srcWikipedia(rom, q) {
  const t = q.replace(/video game/i, '').trim();
  const d = await jget(`https://en.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(t + ' video game')}&gsrlimit=12&prop=pageimages&piprop=thumbnail&pilicense=any&pithumbsize=500&format=json&origin=*`);
  return Object.values((d.query && d.query.pages) || {}).sort((a, b) => a.index - b.index).filter((p) => p.thumbnail)
    .map((p) => ({ thumb: p.thumbnail.source, full: p.thumbnail.source, label: 'Wikipedia: ' + p.title }));
}
async function srcCommons(rom, q) {
  const d = await jget(`https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrnamespace=6&gsrsearch=${encodeURIComponent('filetype:bitmap ' + q)}&gsrlimit=12&prop=imageinfo&iiprop=url%7Cmime&iiurlwidth=500&format=json&origin=*`);
  return Object.values((d.query && d.query.pages) || {}).sort((a, b) => a.index - b.index).filter((p) => p.imageinfo && /^image\/(jpeg|png|webp|gif)/.test(p.imageinfo[0].mime))
    .map((p) => ({ thumb: p.imageinfo[0].thumburl || p.imageinfo[0].url, full: p.imageinfo[0].thumburl || p.imageinfo[0].url, label: 'Commons: ' + p.title.replace(/^File:/, '') }));
}
let iaMissing = null;
async function srcArchive(rom, q) {
  const d = await jget(`https://archive.org/advancedsearch.php?q=${encodeURIComponent(`title:(${q.replace(/[()":]/g, ' ')}) AND (mediatype:software OR mediatype:image)`)}&fl%5B%5D=identifier&fl%5B%5D=title&rows=12&output=json`);
  return ((d.response && d.response.docs) || []).map((x) => ({ thumb: `https://archive.org/services/img/${encodeURIComponent(x.identifier)}`, full: `https://archive.org/services/img/${encodeURIComponent(x.identifier)}`, label: 'Internet Archive: ' + x.title, ia: true }));
}
async function srcRawg(rom, q) {
  const key = getKeys().rawg; if (!key) return null;                      // optional, needs a user-supplied (free) key
  const d = await jget(`https://api.rawg.io/api/games?search=${encodeURIComponent(q)}&page_size=10&key=${encodeURIComponent(key)}`);
  return (d.results || []).filter((g) => g.background_image).map((g) => ({ thumb: g.background_image, full: g.background_image, label: 'RAWG: ' + g.name }));
}
export const SOURCES = [['Libretro', srcLibretro], ['Wikipedia', srcWikipedia], ['Commons', srcCommons], ['Internet Archive', srcArchive], ['RAWG (key)', srcRawg]];

/* ---------- image loading (CORS-aware) ---------- */
const imgProbe = (url) => new Promise((res) => { const i = new Image(); i.referrerPolicy = 'no-referrer'; i.onload = () => res(i); i.onerror = () => res(null); i.src = url; });
async function fetchBlob(url) {
  const r = await fetch(url, { mode: 'cors', referrerPolicy: 'no-referrer' });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const b = await r.blob(); if (b.size < 100) throw new Error('empty');
  return b;
}
/** direct CORS fetch -> optional keyless image proxy (images.weserv.nl, CORS-enabled) -> display-only remote link. */
export async function loadImage(url, { allowProxy = true } = {}) {
  try { return { blob: await fetchBlob(url), via: 'direct' }; } catch {}
  if (allowProxy && /^https?:/.test(url)) { try { return { blob: await fetchBlob(WEIRD_PROXY(url)), via: 'proxy' }; } catch {} }
  const i = await imgProbe(url);
  return i ? { remote: url, via: 'remote' } : null;
}

/* ---------- picker UI ---------- */
export function openCoverPicker(rom, { onSaved } = {}) {
  const dlg = $('#cover'); dlg.replaceChildren();
  const sys = SYSTEMS[rom.system];
  const sysWord = sys.label.replace(/ \/.*$/, '').replace(/\(.*\)/, '').trim();
  let gen = 0;

  const q = el('input', { id: 'cover-q', type: 'search', value: `${cleanTitle(rom.file)} ${sysWord}`, autocomplete: 'off' });
  const go = el('button', { id: 'cover-go', className: 'btn', type: 'button', textContent: 'Search' });
  const status = el('div', { id: 'cover-status', className: 'cv-status' });
  const grid = el('div', { id: 'cover-grid', className: 'cv-grid' });
  const url = el('input', { id: 'cover-url', type: 'url', placeholder: 'Paste image URL (https://…)', autocomplete: 'off' });
  const urlGo = el('button', { id: 'cover-url-go', className: 'btn', type: 'button', textContent: 'Use' });
  const file = el('input', { id: 'cover-file', type: 'file', accept: 'image/*', hidden: true });
  const upBtn = el('button', { className: 'btn', type: 'button', textContent: '📷 Upload / camera roll', onclick: () => file.click() });
  const reset = el('button', { id: 'cover-reset', className: 'btn ghost', type: 'button', textContent: '↺ Reset to automatic' });
  const close = el('button', { className: 'btn ghost', type: 'button', textContent: 'Close', onclick: () => dlg.close() });

  const keys = getKeys();
  const keyIn = el('input', { type: 'text', placeholder: 'RAWG API key (optional, free at rawg.io/apidocs)', value: keys.rawg || '', autocomplete: 'off' });
  keyIn.onchange = () => { setKeys({ ...getKeys(), rawg: keyIn.value.trim() }); };
  const keyBox = el('details', { className: 'cv-keys' }, el('summary', { textContent: 'Optional API keys' }),
    el('p', { className: 'muted small', textContent: 'Everything above works without keys. A RAWG key adds game screenshots/headers. Keys are stored only on this device (localStorage) and sent only to that service. SteamGridDB, IGDB and TheGamesDB need keys and/or server-side calls and are not supported from a static site.' }), keyIn);

  const head = el('div', { className: 'cv-head' }, el('h3', { textContent: 'Change cover' }), close);
  const searchRow = el('div', { className: 'cv-row' }, q, go);
  const urlRow = el('div', { className: 'cv-row' }, url, urlGo);
  const tools = el('div', { className: 'cv-row' }, upBtn, reset, file);
  const main = el('div', { className: 'cv-main' }, head, el('p', { className: 'muted small', textContent: `${rom.title} · ${sys.label}` }), searchRow, urlRow, tools, status, grid, keyBox);
  dlg.append(main);

  /* --- search --- */
  async function runSearch() {
    const my = ++gen; grid.replaceChildren(); status.replaceChildren(el('span', { className: 'cv-src', textContent: 'Searching…' }));
    const chips = {};
    status.replaceChildren(...SOURCES.map(([name]) => (chips[name] = el('span', { className: 'cv-src pending', textContent: name + ' …' }))));
    await Promise.all(SOURCES.map(async ([name, fn]) => {
      try {
        const res = await fn(rom, q.value.trim());
        if (my !== gen) return;
        if (res === null) { chips[name].className = 'cv-src off'; chips[name].textContent = name + ': add key'; return; }
        chips[name].className = 'cv-src ' + (res.length ? 'ok' : 'none'); chips[name].textContent = `${name}: ${res.length}`; chips[name].dataset.count = res.length;
        for (const r of res) grid.append(tile(r, name));
      } catch (e) { chips[name].className = 'cv-src err'; chips[name].textContent = `${name}: failed`; chips[name].title = e.message; chips[name].dataset.count = 'err'; }
    }));
  }
  function tile(r, source) {
    const img = el('img', { src: r.thumb, alt: '', loading: 'lazy', referrerPolicy: 'no-referrer' });
    const t = el('button', { className: 'cv-tile', type: 'button', title: r.label }, img, el('span', { className: 'cv-cap', textContent: r.label }));
    img.onerror = () => t.remove();
    if (r.ia) img.onload = () => { if (img.naturalWidth <= 1 || (img.naturalWidth === 180 && img.naturalHeight === 180 && false)) t.remove(); };
    t.onclick = () => edit({ url: r.full, label: r.label });
    return t;
  }
  go.onclick = runSearch; q.onkeydown = (e) => { if (e.key === 'Enter') runSearch(); };
  urlGo.onclick = () => { const u = url.value.trim(); if (/^(https?:|data:image)/i.test(u)) edit({ url: u, label: 'Pasted URL' }); else status.replaceChildren(el('span', { className: 'cv-src err', textContent: 'Enter a full https:// image URL' })); };
  file.onchange = () => { const f = file.files[0]; file.value = ''; if (f) edit({ file: f, label: f.name }); };
  reset.onclick = async () => { await db.deleteArt(rom.id).catch(() => {}); dlg.close(); onSaved && onSaved({ reset: true }); };

  /* --- editor (crop / fit, pan, zoom) --- */
  async function edit(src) {
    const body = el('div', { className: 'cv-edit' }, el('p', { className: 'muted', textContent: 'Loading image…' }));
    const head = el('div', { className: 'cv-head' }, el('h3', { textContent: 'Preview' }), el('span', { className: 'cv-acts' }, el('button', { className: 'btn ghost', type: 'button', textContent: 'Back', onclick: () => { dlg.replaceChildren(main); } })));
    dlg.replaceChildren(el('div', { className: 'cv-main' }, head, body));
    const toTop = (b) => head.querySelector('.cv-acts').append(b);     // Save sits in the top row, never at the bottom edge
    let loaded;
    try { loaded = src.file ? { blob: src.file, via: 'file' } : await loadImage(src.url); } catch { loaded = null; }
    if (!loaded) { body.replaceChildren(el('p', { className: 'cv-src err', textContent: 'Could not load that image (blocked, missing, or not an image).' })); return; }
    if (loaded.remote) {          // CORS blocked everywhere: can only link to it
      const prev = el('img', { className: 'cv-remote', src: loaded.remote, referrerPolicy: 'no-referrer' });
      const save = el('button', { id: 'cover-save', className: 'btn primary', type: 'button', textContent: 'Use as cover (link only)', onclick: async () => {
        await db.putArt({ id: rom.id, status: 'remote', url: loaded.remote, source: 'custom', custom: true, time: Date.now() }); dlg.close(); onSaved && onSaved({ saved: true, via: 'remote' });
      } });
      body.replaceChildren(prev, el('p', { className: 'muted small', textContent: 'This host blocks cropping/caching (CORS). The cover will be shown straight from the link and needs internet.' })); toTop(save);
      return;
    }
    let bmp; try { bmp = await createImageBitmap(loaded.blob); } catch { body.replaceChildren(el('p', { className: 'cv-src err', textContent: 'That file is not a readable image.' })); return; }
    const cv = el('canvas', { id: 'cover-canvas', width: PRE_W, height: PRE_H, className: 'cv-canvas' });
    let zoom = 1, ox = 0, oy = 0, fit = false;
    const base = () => (fit ? Math.min(PRE_W / bmp.width, PRE_H / bmp.height) : Math.max(PRE_W / bmp.width, PRE_H / bmp.height));
    const clamp = () => {
      const w = bmp.width * base() * zoom, h = bmp.height * base() * zoom;
      const mx = Math.max(0, (w - PRE_W) / 2), my = Math.max(0, (h - PRE_H) / 2);
      if (fit) { ox = oy = 0; } else { ox = Math.max(-mx, Math.min(mx, ox)); oy = Math.max(-my, Math.min(my, oy)); }
    };
    const paint = (ctx, k) => {
      clamp(); ctx.fillStyle = '#0b0c10'; ctx.fillRect(0, 0, PRE_W * k, PRE_H * k);
      const sc = base() * zoom * k, w = bmp.width * sc, h = bmp.height * sc;
      ctx.drawImage(bmp, (PRE_W * k - w) / 2 + ox * k, (PRE_H * k - h) / 2 + oy * k, w, h);
    };
    const draw = () => paint(cv.getContext('2d'), 1);
    let drag = null;
    cv.onpointerdown = (e) => { cv.setPointerCapture(e.pointerId); drag = { x: e.clientX, y: e.clientY, ox, oy }; };
    cv.onpointermove = (e) => { if (!drag) return; ox = drag.ox + (e.clientX - drag.x); oy = drag.oy + (e.clientY - drag.y); draw(); };
    cv.onpointerup = cv.onpointercancel = () => { drag = null; };
    const zr = el('input', { type: 'range', min: 1, max: 3, step: 0.01, value: 1, id: 'cover-zoom', oninput: () => { zoom = Number(zr.value); draw(); } });
    const fitBtn = el('button', { className: 'btn', type: 'button', textContent: 'Fit (no crop)', onclick: () => { fit = !fit; fitBtn.textContent = fit ? 'Fill (crop)' : 'Fit (no crop)'; zoom = 1; zr.value = 1; ox = oy = 0; draw(); } });
    const save = el('button', { id: 'cover-save', className: 'btn primary', type: 'button', textContent: 'Save cover', onclick: async () => {
      save.disabled = true;
      const out = document.createElement('canvas'); out.width = OUT_W; out.height = OUT_H;
      paint(out.getContext('2d'), OUT_W / PRE_W);
      const blob = await new Promise((r) => out.toBlob(r, 'image/jpeg', 0.85));
      await db.putArt({ id: rom.id, status: 'ok', data: await blob.arrayBuffer(), type: 'image/jpeg', source: 'custom', custom: true, name: src.label, via: loaded.via, time: Date.now() });
      dlg.close(); onSaved && onSaved({ saved: true, via: loaded.via });
    } });
    body.replaceChildren(cv, el('label', { className: 'cv-zoom' }, 'Zoom', zr), el('p', { className: 'muted small', textContent: `Drag to reposition. ${loaded.via === 'proxy' ? 'Loaded through the keyless image proxy images.weserv.nl (the host blocks direct access).' : ''}` }), el('div', { className: 'cv-row' }, fitBtn)); toTop(save);
    draw();
  }

  dlg.showModal();
  runSearch();
}

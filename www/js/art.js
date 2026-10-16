// Automatic box art from the libretro thumbnails project (https://github.com/libretro-thumbnails).
//
// CORS finding: https://thumbnails.libretro.com sends NO Access-Control-Allow-Origin header, so fetch() is blocked
// and an <img> loaded from it taints a canvas (it can be displayed but not saved to IndexedDB). The very same
// files are published in GitHub repos whose raw.githubusercontent.com / api.github.com endpoints DO send
// `Access-Control-Allow-Origin: *`, so art is fetched from there, downscaled with a canvas and cached in IndexedDB
// (works offline afterwards). thumbnails.libretro.com is only used as a last, display-only fallback (<img>).
import * as db from './db.js';

export const REPOS = {
  gb: 'Nintendo_-_Game_Boy', gbc: 'Nintendo_-_Game_Boy_Color', gba: 'Nintendo_-_Game_Boy_Advance',
  nes: 'Nintendo_-_Nintendo_Entertainment_System', snes: 'Nintendo_-_Super_Nintendo_Entertainment_System', nds: 'Nintendo_-_Nintendo_DS',
};
export const FOLDERS = {   // directory names on thumbnails.libretro.com
  gb: 'Nintendo - Game Boy', gbc: 'Nintendo - Game Boy Color', gba: 'Nintendo - Game Boy Advance',
  nes: 'Nintendo - Nintendo Entertainment System', snes: 'Nintendo - Super Nintendo Entertainment System', nds: 'Nintendo - Nintendo DS',
};
const KINDS = ['Named_Boxarts', 'Named_Titles'];
const RAW = 'https://raw.githubusercontent.com/libretro-thumbnails/';
const API = 'https://api.github.com/repos/libretro-thumbnails/';
const INDEX_TTL = 30 * 24 * 3600 * 1000;
const REGIONS = ['World', 'USA', 'USA, Europe', 'Europe', 'Japan', 'Japan, USA', 'USA, Australia', 'Europe, Australia', 'Japan, Europe', 'Germany', 'France', 'Spain', 'Italy', 'Korea'];

/** libretro replaces these characters in thumbnail file names with "_". */
export const sanitize = (s) => s.replace(/[&*\/:`<>?\\|"]/g, '_');
const stripExt = (n) => n.replace(/\.[A-Za-z0-9]{1,5}$/, '');

/** Lower-case title without tags/punctuation; "Legend of Zelda, The - X" == "The Legend of Zelda: X". */
export function normTitle(name) {
  let s = stripExt(name).replace(/\s*[\(\[][^\)\]]*[\)\]]/g, '').replace(/_/g, ' ');
  s = s.replace(/^(.*?),\s*(The|A|An)(\s+-\s+|$)/i, (m, rest, art, tail) => `${art} ${rest}${tail}`);   // "X, The - Y" -> "The X - Y"
  return s.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
}
/** "Super Mario Bros. (World) [!].nes" -> "Super Mario Bros." */
export function cleanTitle(name) {
  return stripExt(name).replace(/\s*[\(\[][^\)\]]*[\)\]]/g, '').replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
}
const tagsOf = (name) => { const m = stripExt(name).match(/\(([^)]*)\)/); return m ? m[1] : ''; };
const regionRank = (tags) => /World/.test(tags) ? 0 : /^USA/.test(tags) || /USA/.test(tags) && !/Japan/.test(tags) ? 1 : /Europe/.test(tags) ? 2 : /Japan/.test(tags) ? 3 : 4;
const BAD = /\((Beta|Proto|Demo|Sample|Unl|Pirate|Kiosk|Promo|Aftermarket|Debug)|\[BIOS\]|\bBIOS\b/i;

/** Pick the best file name from the repo's listing for a ROM file name, or null. */
export function bestMatch(romFile, names) {
  const exact = sanitize(stripExt(romFile)) + '.png';
  if (names.includes(exact)) return exact;
  const q = normTitle(romFile); if (!q) return null;
  const qTags = tagsOf(romFile);
  const score = (n, base) => base + regionRank(tagsOf(n)) + (BAD.test(n) ? 10 : 0) + (qTags && tagsOf(n) === qTags ? -5 : 0) + (/Rev|v1\.[1-9]/.test(n) ? 0.2 : 0);
  let best = null, bestScore = Infinity;
  for (const n of names) {
    const t = normTitle(n);
    if (t === q) { const sc = score(n, 0); if (sc < bestScore) { best = n; bestScore = sc; } }
  }
  if (best) return best;
  // looser: one title starts with the other ("Tetris" vs "Tetris Attack" is rejected by requiring a word boundary + >=60% length)
  const qw = new Set(q.split(' '));
  for (const n of names) {
    const t = normTitle(n); if (!t) continue;
    const tw = new Set(t.split(' ')); let inter = 0; for (const w of qw) if (tw.has(w)) inter++;
    const jac = inter / (qw.size + tw.size - inter);
    if (jac >= 0.75) { const sc = score(n, 3 + (1 - jac) * 4); if (sc < bestScore) { best = n; bestScore = sc; } }
  }
  return best;
}

export async function getIndex(system, kind, { force = false } = {}) {
  const repo = REPOS[system]; if (!repo) return null;
  const key = `idx:${repo}:${kind}`;
  const cached = await db.getMeta(key).catch(() => null);
  if (cached && !force && Date.now() - cached.time < INDEX_TTL) return cached.names;
  try {
    const root = await (await fetch(`${API}${repo}/git/trees/master`)).json();
    const dir = (root.tree || []).find((e) => e.path === kind); if (!dir) throw new Error('no ' + kind);
    const tree = await (await fetch(`${API}${repo}/git/trees/${dir.sha}`)).json();
    if (!tree.tree) throw new Error(tree.message || 'bad tree');
    const names = tree.tree.map((e) => e.path).filter((p) => p.endsWith('.png'));
    await db.putMeta({ id: key, names, time: Date.now() });
    return names;
  } catch (e) { console.warn('art index unavailable', key, e.message); return cached ? cached.names : null; }
}

/** Query-driven search over a listing (used by the cover picker). Returns up to `limit` file names, best first. */
export function searchNames(names, query, limit = 12) {
  const toks = (q) => q.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
  const qt = new Set(toks(query)); if (!qt.size) return [];
  const out = [];
  for (const n of names) {
    const tt = new Set(normTitle(n).split(' ')); let inter = 0; for (const w of qt) if (tt.has(w)) inter++;
    if (!inter) continue;
    const jac = inter / (qt.size + tt.size - inter);
    if (inter === qt.size || jac >= 0.6) out.push({ n, sc: (1 - jac) * 10 + regionRank(tagsOf(n)) + (BAD.test(n) ? 10 : 0) });
  }
  return out.sort((a, b) => a.sc - b.sc).slice(0, limit).map((x) => x.n);
}
export const rawUrl = (system, kind, name) => `${RAW}${REPOS[system]}/master/${kind}/${encodeURIComponent(name)}`;

/** Names to try blindly when no listing is available (offline index / API rate limit). */
export function guessNames(romFile) {
  const clean = cleanTitle(romFile), origTags = tagsOf(romFile);
  const bases = new Set([clean, clean.replace(/:\s*/g, ' - ')]);
  const m = clean.match(/^(The|A|An)\s+(.+?)(\s+-\s+.*)?$/i); if (m) bases.add(`${m[2]}, ${m[1]}${m[3] || ''}`);
  const out = [sanitize(stripExt(romFile)) + '.png'];
  for (const b of bases) {
    if (origTags) out.push(sanitize(`${b} (${origTags})`) + '.png');
    for (const r of REGIONS.slice(0, 8)) { out.push(sanitize(`${b} (${r})`) + '.png'); if (r === 'World' || r === 'USA' || r === 'USA, Europe') out.push(sanitize(`${b} (${r}) (Rev 1)`) + '.png'); }
  }
  return [...new Set(out)];
}

async function fetchImage(system, kind, name) {
  const r = await fetch(`${RAW}${REPOS[system]}/master/${kind}/${encodeURIComponent(name)}`);
  if (!r.ok) return null;
  const blob = await r.blob();
  return blob.size > 100 ? blob : null;
}

/** Downscale to <=300px wide JPEG so a whole library is a few MB. */
export async function shrink(blob, maxW = 300) {
  const bmp = await createImageBitmap(blob);
  const k = Math.min(1, maxW / bmp.width), w = Math.max(1, Math.round(bmp.width * k)), h = Math.max(1, Math.round(bmp.height * k));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d'); ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h); ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close && bmp.close();
  const out = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.82));
  return out || blob;
}

/** Display-only last resort: can the browser at least *show* the image from thumbnails.libretro.com? */
function probeImg(url) {
  return new Promise((res) => { const i = new Image(); i.onload = () => res(true); i.onerror = () => res(false); i.referrerPolicy = 'no-referrer'; i.src = url; });
}

/**
 * Find and cache cover art for a ROM record. Returns the art record that was stored
 * ({status:'ok'|'remote'|'none'}). Never throws.
 */
export async function fetchArt(rom, { force = false } = {}) {
  const rec = { id: rom.id, status: 'none', time: Date.now() };
  try {
    if (!REPOS[rom.system]) { await db.putArt(rec); return rec; }
    for (const kind of KINDS) {
      let names = await getIndex(rom.system, kind, { force });
      let name = names ? bestMatch(rom.file, names) : null;
      let blob = null;
      if (name) blob = await fetchImage(rom.system, kind, name).catch(() => null);
      else if (!names) {                                           // no listing: blind guesses, 6 at a time
        const guesses = guessNames(rom.file);
        for (let i = 0; i < guesses.length && !blob; i += 6) {
          const batch = await Promise.all(guesses.slice(i, i + 6).map((n) => fetchImage(rom.system, kind, n).then((b) => b && { b, n }).catch(() => null)));
          const hit = batch.find(Boolean); if (hit) { blob = hit.b; name = hit.n; }
        }
      }
      if (blob) {
        const small = await shrink(blob).catch(() => blob);
        Object.assign(rec, { status: 'ok', data: await small.arrayBuffer(), type: small.type || 'image/png', source: kind === 'Named_Boxarts' ? 'boxart' : 'title', name });
        break;
      }
      if (name && FOLDERS[rom.system]) {   // known file name but raw fetch failed: show straight from thumbnails.libretro.com
        const url = `https://thumbnails.libretro.com/${encodeURIComponent(FOLDERS[rom.system])}/${kind}/${encodeURIComponent(name)}`;
        if (await probeImg(url)) { Object.assign(rec, { status: 'remote', url, source: kind, name }); break; }
      }
    }
  } catch (e) { console.warn('fetchArt', e); }
  await db.putArt(rec).catch(() => {});
  return rec;
}

/** Object URL for a stored art record (caller revokes), or the remote URL, or null. */
export function artUrl(rec) {
  if (!rec) return null;
  if (rec.status === 'ok' && rec.data) return URL.createObjectURL(new Blob([rec.data], { type: rec.type || 'image/jpeg' }));
  if (rec.status === 'remote') return rec.url;
  return null;
}

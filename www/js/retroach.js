// RetroAchievements: account login (username + personal Web API key), hardcore toggle, and an in-game achievement list with the
// player's unlock status for the running game (matched by RetroAchievements' own ROM hash).
// Honest limit: RetroAchievements only accepts unlocks from approved emulators (RetroArch etc.) talking to its private client API, which
// does not allow browser (CORS) access, and EmulatorJS cores do not expose memory for rcheevos. So Retro Pocket SHOWS achievements and
// progress (synced from your other emulators) and enforces hardcore rules locally, but it cannot award new unlocks.
const API = 'https://retroachievements.org/API/';
const LS = 'rp.ra';
export const MEDIA = 'https://media.retroachievements.org/Badge/';

export function loadRA() {
  let c = {}; try { c = JSON.parse(localStorage.getItem(LS) || '{}'); } catch {}
  let keys = {}; try { keys = JSON.parse(localStorage.getItem('rp.keys') || '{}'); } catch {}
  return { user: c.user || '', hardcore: !!c.hardcore, key: keys.ra || '' };
}
export function saveRA({ user, hardcore, key }) {
  localStorage.setItem(LS, JSON.stringify({ user: user || '', hardcore: !!hardcore }));
  let keys = {}; try { keys = JSON.parse(localStorage.getItem('rp.keys') || '{}'); } catch {}
  if (key) keys.ra = key; else delete keys.ra;             // the API key lives with the other personal keys: never in backups
  localStorage.setItem('rp.keys', JSON.stringify(keys));
}
export const hardcoreOn = () => { const c = loadRA(); return !!(c.user && c.key && c.hardcore); };

async function call(fn, params) {
  const c = loadRA(); if (!c.user || !c.key) throw new Error('Log in to RetroAchievements first (Settings → 🏆 RetroAchievements)');
  const q = new URLSearchParams({ ...params, y: c.key });
  const r = await fetch(`${API}${fn}.php?${q}`);
  if (r.status === 401 || r.status === 403) throw new Error('RetroAchievements rejected the username / Web API key');
  if (!r.ok) throw new Error(`RetroAchievements error ${r.status}`);
  return r.json();
}
export async function login(user, key) {
  saveRA({ ...loadRA(), user, key });
  try {
    const p = await call('API_GetUserProfile', { u: user });
    if (!p || !p.User) throw new Error('Unknown RetroAchievements user');
    return p;
  } catch (e) { saveRA({ ...loadRA(), user: '', key: '' }); throw e; }
}
export const logout = () => saveRA({ user: '', key: '', hardcore: loadRA().hardcore });

// RetroAchievements console ids for cartridge systems we can hash in the browser (disc systems need RA's sector-based hashing: not supported)
export const CONSOLE = { md: 1, n64: 2, snes: 3, gb: 4, gba: 5, gbc: 6, nes: 7, pce: 8, s32x: 10, sms: 11, lynx: 13, ngp: 14, ngpc: 14, gg: 15, jaguar: 17, vb: 28, a2600: 25, sg1000: 33, coleco: 44, a7800: 51, ws: 53, wsc: 53 };

/* ---------- RetroAchievements ROM hash (rcheevos rules for cartridge systems) ---------- */
export function raBytes(system, u8) {
  const n = u8.length;
  if (system === 'nes' && u8[0] === 0x4e && u8[1] === 0x45 && u8[2] === 0x53 && u8[3] === 0x1a) return u8.subarray(16);   // iNES header
  if (system === 'nes' && u8[0] === 0x46 && u8[1] === 0x44 && u8[2] === 0x53 && u8[3] === 0x1a) return u8.subarray(16);   // fwNES FDS header
  if ((system === 'snes' || system === 'pce') && n % 1024 === 512) return u8.subarray(512);                             // copier header
  if (system === 'lynx' && u8[0] === 0x4c && u8[1] === 0x59 && u8[2] === 0x4e && u8[3] === 0x58) return u8.subarray(64);
  if (system === 'a7800' && String.fromCharCode(...u8.subarray(1, 10)) === 'ATARI7800') return u8.subarray(128);
  if (system === 'n64') {                                                                                               // hash the big-endian (.z64) byte order
    const out = new Uint8Array(n);
    if (u8[0] === 0x37) { for (let i = 0; i + 1 < n; i += 2) { out[i] = u8[i + 1]; out[i + 1] = u8[i]; } return out; }           // .v64
    if (u8[0] === 0x40) { for (let i = 0; i + 3 < n; i += 4) { out[i] = u8[i + 3]; out[i + 1] = u8[i + 2]; out[i + 2] = u8[i + 1]; out[i + 3] = u8[i]; } return out; } // .n64
  }
  return u8;
}
export function md5(u8) {
  const K = new Int32Array(64), S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
  for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) | 0;
  const n = u8.length, total = ((n + 8) >>> 6 << 6) + 64, buf = new Uint8Array(total);
  buf.set(u8); buf[n] = 0x80; const dv = new DataView(buf.buffer);
  dv.setUint32(total - 8, (n << 3) >>> 0, true); dv.setUint32(total - 4, Math.floor(n / 536870912), true);
  let a0 = 0x67452301, b0 = 0xefcdab89 | 0, c0 = 0x98badcfe | 0, d0 = 0x10325476;
  const M = new Int32Array(16);
  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) M[i] = dv.getInt32(off + i * 4, true);
    let A = a0, B = b0, C = c0, D = d0;
    for (let i = 0; i < 64; i++) {
      let F, g;
      if (i < 16) { F = (B & C) | (~B & D); g = i; } else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) & 15; }
      else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) & 15; } else { F = C ^ (B | ~D); g = (7 * i) & 15; }
      const s = S[(i >> 4) * 4 + (i & 3)], t = (A + F + K[i] + M[g]) | 0;
      A = D; D = C; C = B; B = (B + ((t << s) | (t >>> (32 - s)))) | 0;
    }
    a0 = (a0 + A) | 0; b0 = (b0 + B) | 0; c0 = (c0 + C) | 0; d0 = (d0 + D) | 0;
  }
  const out = new DataView(new ArrayBuffer(16)); [a0, b0, c0, d0].forEach((v, i) => out.setInt32(i * 4, v, true));
  return [...new Uint8Array(out.buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
export const raHash = (system, buf) => md5(raBytes(system, new Uint8Array(buf)));

/* ---------- game lookup + progress ---------- */
async function gameList(consoleId) {                       // all games with achievements for a console, with their hashes (cached 7 days)
  const k = 'rp.raList.' + consoleId;
  try { const c = JSON.parse(localStorage.getItem(k) || 'null'); if (c && Date.now() - c.t < 7 * 864e5) return c.list; } catch {}
  const list = (await call('API_GetGameList', { i: consoleId, h: 1, f: 1 })).map((g) => [g.ID, g.Title, (g.Hashes || []).map((h) => h.toLowerCase())]);
  try { localStorage.setItem(k, JSON.stringify({ t: Date.now(), list })); } catch {}
  return list;
}
// → { supported, game?: {id,title,icon}, achievements: [{id,title,description,points,badge,unlocked,hardcore}], earned, total, hash }
export async function gameProgress(rom) {
  const cid = CONSOLE[rom.system];
  if (!cid) return { supported: false, reason: 'RetroAchievements matching is not available for this system in the browser (disc-based and computer systems need RetroArch).' };
  const hash = rom.raHash || raHash(rom.system, rom.data);
  const hit = (await gameList(cid)).find((g) => g[2].includes(hash));
  if (!hit) return { supported: true, hash, game: null, achievements: [] };
  const c = loadRA(), g = await call('API_GetGameInfoAndUserProgress', { g: hit[0], u: c.user });
  const achievements = Object.values(g.Achievements || {}).sort((a, b) => (a.DisplayOrder || 0) - (b.DisplayOrder || 0) || a.ID - b.ID).map((a) => ({
    id: a.ID, title: a.Title, description: a.Description, points: a.Points, badge: a.BadgeName, unlocked: !!(a.DateEarned || a.DateEarnedHardcore), hardcore: !!a.DateEarnedHardcore,
  }));
  return { supported: true, hash, game: { id: hit[0], title: g.Title || hit[1], icon: g.ImageIcon ? 'https://media.retroachievements.org' + g.ImageIcon : '' }, achievements, earned: achievements.filter((a) => a.unlocked).length, total: achievements.length };
}

const el = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); for (const k of kids) if (k != null && k !== '') e.append(k); return e; };
export function achievementsPanel(rom) {
  const box = el('div', { className: 'ra-panel', id: 'ra-panel' }, el('p', { className: 'muted', textContent: 'Loading achievements…' }));
  const c = loadRA();
  if (!c.user || !c.key) { box.replaceChildren(el('p', { textContent: 'Log in to RetroAchievements in Settings → 🏆 RetroAchievements to see this game\'s achievements.' })); return box; }
  gameProgress(rom).then((p) => {
    if (!p.supported) return box.replaceChildren(el('p', { className: 'muted', textContent: p.reason }));
    if (!p.game) return box.replaceChildren(el('p', { textContent: 'This ROM is not recognised by RetroAchievements (no achievement set for this exact dump).' }), el('p', { className: 'muted small', textContent: 'RA hash: ' + p.hash }));
    box.replaceChildren(
      el('p', { className: 'ra-head', id: 'ra-summary', textContent: `${p.game.title} — ${p.earned}/${p.total} unlocked${hardcoreOn() ? ' · HARDCORE rules on' : ''}` }),
      el('p', { className: 'muted small', textContent: 'Unlocks earned in RetroArch or other approved emulators show here. RetroAchievements does not accept unlocks from browser emulators, so playing here does not award new ones.' }),
      ...p.achievements.map((a) => el('div', { className: 'ra-ach' + (a.unlocked ? ' on' : '') },
        el('img', { src: `${MEDIA}${a.badge}${a.unlocked ? '' : '_lock'}.png`, alt: '', loading: 'lazy', width: 40, height: 40 }),
        el('div', {}, el('b', { textContent: `${a.title} (${a.points})` }), el('span', { className: 'muted small', textContent: (a.hardcore ? '🏆 hardcore · ' : a.unlocked ? '✓ softcore · ' : '') + a.description })))));
  }).catch((e) => box.replaceChildren(el('p', { className: 'warn-txt', textContent: e.message })));
  return box;
}

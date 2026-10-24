// Light per-game metadata kept out of the big ROM records (so updating it never rewrites a ROM blob):
// favourites, play time, play count, last played, and user collections. Stored in localStorage (included in backups).
const MK = 'rp.meta', CK = 'rp.collections';
const read = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) || d; } catch { return d; } };
export const allMeta = () => read(MK, {});
export const meta = (id) => allMeta()[id] || {};
export function setMeta(id, patch) { const m = allMeta(); m[id] = { ...(m[id] || {}), ...patch }; localStorage.setItem(MK, JSON.stringify(m)); return m[id]; }
// per-game compatibility note ("runs best on melonDS", "slow on my phone"): shown in the game sheet and the in-game ☰ menu
export const getNote = (id) => meta(id).note || '';
export const setNote = (id, t) => setMeta(id, { note: String(t || '').trim().slice(0, 200) }).note;
export const isFav = (id) => !!meta(id).fav;
export const toggleFav = (id) => setMeta(id, { fav: !isFav(id) }).fav;
export function addPlay(id, ms) { if (!(ms > 0)) return; const m = meta(id); setMeta(id, { play: (m.play || 0) + Math.round(ms), last: Date.now() }); }
export function startSession(id) { const m = meta(id); setMeta(id, { plays: (m.plays || 0) + 1, last: Date.now() }); }
export function fmtTime(ms) {
  if (!ms || ms < 60000) return ms ? '<1m' : '';
  const m = Math.floor(ms / 60000), h = Math.floor(m / 60);
  return h ? `${h}h ${m % 60}m` : `${m}m`;
}
export function forget(id) {
  const m = allMeta(); delete m[id]; localStorage.setItem(MK, JSON.stringify(m));
  saveCollections(collections().map((c) => ({ ...c, ids: c.ids.filter((x) => x !== id) })));
}
// collections: [{id, name, ids:[romId]}]
export const collections = () => read(CK, []);
export const saveCollections = (l) => localStorage.setItem(CK, JSON.stringify(l));
export function newCollection(name) { const l = collections(), c = { id: 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), name: name.trim().slice(0, 40), ids: [] }; l.push(c); saveCollections(l); return c; }
export function setInCollection(cid, romId, on) {
  saveCollections(collections().map((c) => c.id !== cid ? c : { ...c, ids: on ? [...new Set([...c.ids, romId])] : c.ids.filter((x) => x !== romId) }));
}
export const renameCollection = (cid, name) => saveCollections(collections().map((c) => c.id === cid ? { ...c, name: name.trim().slice(0, 40) } : c));
export const deleteCollection = (cid) => saveCollections(collections().filter((c) => c.id !== cid));
// play-time tracker for the player page: counts only while the game runs, the page is visible and not paused
export function trackPlay(id, isRunning) {
  let lastTick = Date.now();
  const flush = () => { const now = Date.now(), dt = now - lastTick; lastTick = now; if (dt > 0 && dt < 120000 && document.visibilityState === 'visible' && isRunning()) addPlay(id, dt); };
  const iv = setInterval(flush, 15000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); else lastTick = Date.now(); });
  addEventListener('pagehide', flush);
  return { flush, stop: () => { flush(); clearInterval(iv); } };
}

// Google Drive cloud save sync. The app signs in with Google Identity Services (OAuth "token" flow, no server). It uses only the
// drive.appdata scope, which is a hidden per-app folder: Retro Pocket can never see the user's other Drive files.
// What gets synced: in-game battery saves (EmulatorJS' IDBFS database "/data/saves") and Retro Pocket's auto-resume states.
// It never syncs games, BIOS or API keys. Newest copy wins per file and nothing is ever deleted remotely.
import * as db from './db.js';

const SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const API = 'https://www.googleapis.com/drive/v3', UP = 'https://www.googleapis.com/upload/drive/v3';
const KEY = 'rp.cloud', TOK = 'rp.cloudTok';
const SAVES_DB = '/data/saves', STORE = 'FILE_DATA', DIR_MODE = 16872, FILE_MODE = 33206;

export const loadCloud = () => { try { return { clientId: '', auto: true, last: 0, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return { clientId: '', auto: true, last: 0 }; } };
export const saveCloud = (c) => localStorage.setItem(KEY, JSON.stringify(c));
export const isApkWebView = () => !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
const validId = (id) => /^[\w-]+\.apps\.googleusercontent\.com$/.test(id || '');
export { validId as validClientId };

/* ---------- auth (Google Identity Services token client) ---------- */
let gisP;
function loadGis() {
  if (window.google && google.accounts && google.accounts.oauth2) return Promise.resolve();
  return gisP ||= new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = 'https://accounts.google.com/gsi/client'; s.async = true;
    s.onload = () => res(); s.onerror = () => { gisP = null; rej(new Error('Could not load Google sign-in (offline?)')); };
    document.head.append(s);
  });
}
function cachedToken() {
  try { const t = JSON.parse(sessionStorage.getItem(TOK) || 'null'); return t && t.exp > Date.now() + 60000 ? t.t : null; } catch { return null; }
}
export const hasSession = () => !!cachedToken();      // a token from this app session: background sync needs no popup
// interactive = from a button tap (popup allowed). Otherwise it tries silently and fails if Google needs to show UI.
export async function getToken({ interactive = false } = {}) {
  const t = cachedToken(); if (t) return t;
  const c = loadCloud(); if (!validId(c.clientId)) throw new Error('Enter your Google OAuth client ID first');
  await loadGis();
  return new Promise((res, rej) => {
    const client = google.accounts.oauth2.initTokenClient({
      client_id: c.clientId, scope: SCOPE, prompt: interactive ? (c.email ? '' : 'consent') : 'none', hint: c.email || undefined,
      callback: (r) => {
        if (r.error) return rej(new Error(r.error_description || r.error));
        if (!google.accounts.oauth2.hasGrantedAllScopes(r, SCOPE)) return rej(new Error('Drive app-data permission was not granted'));
        sessionStorage.setItem(TOK, JSON.stringify({ t: r.access_token, exp: Date.now() + (Number(r.expires_in) || 3600) * 1000 }));
        res(r.access_token);
      },
      error_callback: (e) => rej(new Error(e && e.type === 'popup_closed' ? 'Sign-in was cancelled' : (e && (e.message || e.type)) || 'Sign-in failed')),
    });
    client.requestAccessToken();
  });
}
export async function signIn() {
  const tok = await getToken({ interactive: true });
  const c = loadCloud();
  try { const r = await api(tok, `${API}/about?fields=user(emailAddress)`); c.email = (await r.json()).user.emailAddress; } catch { c.email = c.email || 'signed in'; }
  saveCloud(c); return c.email;
}
export function signOut() {
  const t = cachedToken(); sessionStorage.removeItem(TOK);
  const c = loadCloud(); delete c.email; saveCloud(c);
  try { if (t && window.google) google.accounts.oauth2.revoke(t, () => {}); } catch {}
}

async function api(tok, url, opts = {}) {
  const r = await fetch(url, { ...opts, headers: { Authorization: `Bearer ${tok}`, ...(opts.headers || {}) } });
  if (r.status === 401) { sessionStorage.removeItem(TOK); throw new Error('Google sign-in expired — tap Sign in again'); }
  if (!r.ok) throw new Error(`Google Drive error ${r.status}: ${(await r.text()).slice(0, 160)}`);
  return r;
}

/* ---------- local side ---------- */
function openSaves() {
  return new Promise((res, rej) => {
    const q = indexedDB.open(SAVES_DB, 21);                     // same version/layout as Emscripten's IDBFS so EmulatorJS mounts it as-is
    q.onupgradeneeded = () => { const d = q.result; const s = d.objectStoreNames.contains(STORE) ? q.transaction.objectStore(STORE) : d.createObjectStore(STORE); if (!s.indexNames.contains('timestamp')) s.createIndex('timestamp', 'timestamp', { unique: false }); };
    q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error);
  });
}
const idb = (req) => new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });
async function localItems() {
  const items = new Map();
  const d = await openSaves();
  try {
    const st = d.transaction(STORE).objectStore(STORE);
    const [keys, vals] = await Promise.all([idb(st.getAllKeys()), idb(st.getAll())]);
    keys.forEach((k, i) => { const v = vals[i]; if (v && v.contents && v.contents.length) items.set('sram:' + k, { mt: +new Date(v.timestamp), size: v.contents.length, data: () => v.contents, mode: v.mode }); });
  } finally { d.close(); }
  for (const id of await db.allStateIds()) {
    const s = await db.getState(id); if (!s || !s.data) continue;
    items.set('state:' + id, { mt: s.time || 0, size: s.data.byteLength, core: s.core, data: () => new Uint8Array(s.data) });
  }
  return items;
}
async function writeLocal(key, bytes, props, mt) {
  if (key.startsWith('state:')) { await db.putState({ id: key.slice(6), core: props.core || '', data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), time: mt }); return; }
  const path = key.slice(5); if (!path.startsWith(SAVES_DB + '/') || path.includes('..')) return;
  const d = await openSaves();
  try {
    const t = d.transaction(STORE, 'readwrite'), st = t.objectStore(STORE), parts = path.split('/');
    for (let i = 4; i < parts.length; i++) { const dir = parts.slice(0, i).join('/'); if (!(await idb(st.get(dir)))) st.put({ timestamp: new Date(mt), mode: DIR_MODE }, dir); }  // parents of /data/saves/<Core>/<file>
    st.put({ timestamp: new Date(mt), mode: Number(props.mode) || FILE_MODE, contents: bytes }, path);
    await new Promise((res, rej) => { t.oncomplete = res; t.onerror = () => rej(t.error); });
  } finally { d.close(); }
}

/* ---------- remote side (appDataFolder) ---------- */
async function remoteItems(tok) {
  const out = new Map(); let pageToken = '';
  do {
    const r = await api(tok, `${API}/files?spaces=appDataFolder&pageSize=1000&fields=nextPageToken,files(id,name,size,appProperties)${pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : ''}`);
    const j = await r.json();
    for (const f of j.files || []) if (/^(sram|state):/.test(f.name) && f.appProperties) out.set(f.name, { id: f.id, mt: Number(f.appProperties.mt) || 0, props: f.appProperties });
    pageToken = j.nextPageToken || '';
  } while (pageToken);
  return out;
}
async function upload(tok, key, item, existingId) {
  const meta = { name: key, appProperties: { mt: String(item.mt), h: item.h, ...(item.core ? { core: item.core } : {}), ...(item.mode ? { mode: String(item.mode) } : {}) } };
  if (!existingId) meta.parents = ['appDataFolder'];
  const bnd = 'rp' + Math.random().toString(36).slice(2);
  const body = new Blob([`--${bnd}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${bnd}\r\nContent-Type: application/octet-stream\r\n\r\n`, item.data(), `\r\n--${bnd}--`]);
  await api(tok, `${UP}/files${existingId ? '/' + existingId : ''}?uploadType=multipart&fields=id`, { method: existingId ? 'PATCH' : 'POST', headers: { 'Content-Type': `multipart/related; boundary=${bnd}` }, body });
}

let busy = null;
// Returns {up, down, same}. Newest copy wins (by save time); never deletes anything.
export function syncNow({ interactive = false, onProgress = () => {} } = {}) {
  return busy ||= (async () => {
    try {
      const tok = await getToken({ interactive });
      onProgress('Comparing…');
      const [loc, rem] = await Promise.all([localItems(), remoteItems(tok)]);
      const res = { up: 0, down: 0, same: 0 }, keys = new Set([...loc.keys(), ...[...rem.keys()]]);
      let n = 0;
      for (const key of keys) {
        const l = loc.get(key), r = rem.get(key); n++;
        if (l) { const d = l.data(); l.h = await db.sha256Hex(d.buffer.byteLength === d.byteLength ? d.buffer : d.slice().buffer); }
        if (l && r && r.props.h && r.props.h === l.h) { res.same++; continue; }       // same bytes: nothing to do whatever the timestamps say
        if (l && (!r || l.mt > r.mt)) { onProgress(`Uploading ${n}/${keys.size}…`); await upload(tok, key, l, r && r.id); res.up++; }
        else if (r && (!l || r.mt > l.mt)) {
          onProgress(`Downloading ${n}/${keys.size}…`);
          const bytes = new Uint8Array(await (await api(tok, `${API}/files/${r.id}?alt=media`)).arrayBuffer());
          await writeLocal(key, bytes, r.props, r.mt); res.down++;
        } else res.same++;
      }
      const c = loadCloud(); c.last = Date.now(); c.lastResult = res; saveCloud(c);
      return res;
    } finally { busy = null; }
  })();
}

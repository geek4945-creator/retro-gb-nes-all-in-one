// Online / LAN play, host side. The host runs the game; each guest gets the host's screen + sound as a live WebRTC
// stream and sends its button presses back over a WebRTC data channel, which are fed into the emulator as Player 2-4
// (or shared Player 1 / watch only). Guests need no ROM, no BIOS and no matching core: works with every system.
// Signalling via PeerJS (public cloud by default, or your own /server); the media itself is peer-to-peer.
import { loadNet, peerOptions, newCode, peerId, loadPeer, serverLabel } from './netcfg.js';

const PAGES_URL = 'https://geek4945-creator.github.io/retro-gb-nes-all-in-one/';
const el = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids.filter((k) => k != null)); return e; };

let H = null;            // { emu, rom, maxP, toast }
let peer = null, code = '', stream = null, status = 'idle', lastErr = '';
const guests = new Map();     // conn.peer -> { conn, call, name, slot, held: Map(id -> v), ping, joined }
let redraw = () => {};

export const isHosting = () => !!peer && status === 'open';
export const guestCount = () => guests.size;
export const roomCode = () => code;
export function init(h) { H = h; }

export function joinLink() {
  // the Android app's pages live on https://localhost inside the APK, which friends cannot open: link to the web version instead
  const u = new URL('join.html', window.Capacitor || !/^https?:$/.test(location.protocol) ? PAGES_URL : location.href);
  u.search = ''; u.searchParams.set('room', code);
  const c = loadNet(); if (c.server) u.searchParams.set('srv', c.server);
  return u.href;
}

function mediaStream() {
  if (stream && stream.getVideoTracks().some((t) => t.readyState === 'live')) return stream;
  const e = H.emu(); const canvas = e && (e.canvas || document.querySelector('#game canvas'));
  if (!canvas || !canvas.captureStream) throw new Error('This browser cannot stream the game screen');
  stream = canvas.captureStream(60);
  try { stream.getVideoTracks()[0].contentHint = 'motion'; } catch {}
  try {                       // tap EmulatorJS' OpenAL master gain so guests hear the game too
    const al = e.Module.AL.currentCtx, ac = al.audioCtx, dest = ac.createMediaStreamDestination();
    (al.gain || al.masterGain).connect(dest); dest.stream.getAudioTracks().forEach((t) => stream.addTrack(t));
  } catch (x) { console.warn('netplay: no audio tap', x); }
  return stream;
}

const usedSlots = () => new Set([...guests.values()].map((g) => g.slot).filter((s) => s > 0));
function defaultSlot() {
  for (let s = 1; s < H.maxP(); s++) if (!usedSlots().has(s)) return s;
  return H.maxP() <= 1 ? 0 : -1;                         // 1-player systems: share Player 1 (take turns / help out); full: watch
}
const slotName = (s) => (s < 0 ? 'Watching' : s === 0 ? 'Player 1 (shared with host)' : `Player ${s + 1}`);

function release(g) {
  const gm = H.emu() && H.emu().gameManager; if (!gm) return;
  for (const [id] of g.held) { try { gm.simulateInput(g.slot, id, 0); } catch {} }
  g.held.clear();
}
export function setSlot(pid, slot) {
  const g = guests.get(pid); if (!g) return;
  release(g); g.slot = slot; send(g, { t: 'slot', slot, label: slotName(slot) }); redraw(); badge();
}
const send = (g, m) => { try { g.conn.open && g.conn.send(m); } catch {} };
export function broadcast(m) { for (const g of guests.values()) send(g, m); }

function onData(g, d) {
  if (!d || typeof d !== 'object') return;
  if (d.t === 'in') {
    if (g.slot < 0) return;
    const id = d.i | 0, v = Math.max(-32767, Math.min(32767, Number(d.v) || 0));
    if (id < 0 || id > 23) return;
    if (v) g.held.set(id, v); else g.held.delete(id);
    try { H.emu().gameManager.simulateInput(g.slot, id, id >= 16 ? Math.abs(v) : (v ? 1 : 0)); } catch {}
    if (window.__rpNetLog) window.__rpNetLog.push([g.slot, id, v]);
  } else if (d.t === 'ping') send(g, { t: 'pong', ts: d.ts });
  else if (d.t === 'rtt') { g.ping = d.ms | 0; redraw(); }
  else if (d.t === 'name') { g.name = String(d.name || 'Guest').slice(0, 24); redraw(); }
}

function onGuest(conn) {
  conn.on('open', () => {
    const g = { conn, call: null, name: String((conn.metadata && conn.metadata.name) || 'Guest').slice(0, 24), slot: defaultSlot(), held: new Map(), ping: 0, joined: Date.now() };
    guests.set(conn.peer, g);
    send(g, { t: 'hello', title: H.rom().title, system: H.rom().system, slot: g.slot, label: slotName(g.slot), players: H.maxP(), paused: !!(H.emu() && H.emu().paused) });
    try { g.call = peer.call(conn.peer, mediaStream(), { metadata: { room: code } }); g.call.on('close', () => {}); }
    catch (x) { send(g, { t: 'error', msg: x.message }); }
    H.toast(`🌐 ${g.name} joined — ${slotName(g.slot)}`); redraw(); badge();
  });
  conn.on('data', (d) => { const g = guests.get(conn.peer); if (g) onData(g, d); });
  const gone = () => { const g = guests.get(conn.peer); if (!g) return; release(g); try { g.call && g.call.close(); } catch {} guests.delete(conn.peer); H.toast(`🌐 ${g.name} left`); redraw(); badge(); };
  conn.on('close', gone); conn.on('error', gone);
}
export function kick(pid) { const g = guests.get(pid); if (!g) return; send(g, { t: 'kicked' }); setTimeout(() => { try { g.conn.close(); } catch {} }, 150); }

export async function start() {
  if (peer) return;
  status = 'connecting'; lastErr = ''; redraw();
  try {
    const Peer = await loadPeer();
    for (let attempt = 0; attempt < 3; attempt++) {
      code = newCode();
      const p = new Peer(peerId(code), peerOptions());
      const ok = await new Promise((res) => { p.on('open', () => res(true)); p.on('error', (e) => { lastErr = (e && (e.type || e.message)) || 'error'; res(e && e.type === 'unavailable-id' ? false : null); }); setTimeout(() => res(null), 15000); });
      if (ok) { peer = p; break; }
      try { p.destroy(); } catch {}
      if (ok === null) throw new Error(`Could not reach the online-play server (${serverLabel()}): ${lastErr || 'timeout'}`);
    }
    if (!peer) throw new Error('No free room code, try again');
    peer.on('connection', onGuest);
    peer.on('disconnected', () => { if (peer && !peer.destroyed) try { peer.reconnect(); } catch {} });
    peer.on('error', (e) => { console.warn('netplay', e); if (e && e.type === 'network') { lastErr = 'server connection lost (guests already connected keep playing)'; redraw(); } });
    status = 'open'; window.__rpNetCode = code;
    try { mediaStream(); } catch (x) { console.warn(x); }
  } catch (e) { status = 'idle'; lastErr = e.message; peer = null; code = ''; }
  redraw(); badge();
}
export function stop() {
  broadcast({ t: 'ended' });
  for (const g of guests.values()) { release(g); try { g.call && g.call.close(); g.conn.close(); } catch {} }
  guests.clear();
  try { peer && peer.destroy(); } catch {}
  peer = null; code = ''; status = 'idle'; window.__rpNetCode = '';
  if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
  redraw(); badge();
}
addEventListener('pagehide', () => { if (peer) stop(); });

function badge() {
  let b = document.getElementById('net-badge');
  if (!isHosting()) { if (b) b.hidden = true; return; }
  if (!b) { b = el('div', { id: 'net-badge' }); document.body.append(b); }
  b.hidden = false; b.textContent = `🌐 ${code} · ${guests.size} guest${guests.size === 1 ? '' : 's'}`;
}

/** The "Online play" panel shown inside the ☰ menu. */
export function panel() {
  const box = el('div', { className: 'net-panel' });
  redraw = () => {
    if (!box.isConnected && redraw !== noop) { /* panel closed: keep state, stop drawing */ }
    const kids = [];
    if (status !== 'open') {
      kids.push(
        el('p', { textContent: 'Play this game with friends: they see your screen and control Player 2, 3 or 4 from their phone, tablet or computer — over the internet or on the same Wi-Fi. They do not need the game file.' }),
        el('button', { id: 'net-start', className: 'primary', textContent: status === 'connecting' ? 'Creating room…' : '🌐 Start a room', disabled: status === 'connecting', onclick: start }),
        lastErr ? el('p', { className: 'err', id: 'net-err', textContent: '⚠ ' + lastErr }) : null,
        el('p', { className: 'small', textContent: `Server: ${serverLabel()} · change it in the library under Settings → Online play. Same Wi-Fi: the game stream goes directly between the two devices.` }));
    } else {
      const link = joinLink();
      kids.push(
        el('div', { className: 'net-code' }, el('small', { textContent: 'Room code' }), el('b', { id: 'net-code', textContent: code })),
        el('p', { className: 'small', textContent: 'Friends open the link (or Settings → Online play → Join in their Retro Pocket app) and enter the code.' }),
        el('input', { id: 'net-link', readOnly: true, value: link, onclick: (e) => e.target.select() }),
        el('div', { className: 'net-row' },
          el('button', { textContent: '📋 Copy link', onclick: async () => { try { await navigator.clipboard.writeText(link); H.toast('Link copied'); } catch { H.toast(link); } } }),
          navigator.share ? el('button', { textContent: '📤 Share', onclick: () => navigator.share({ title: 'Play with me on Retro Pocket', text: `Join my game of ${H.rom().title} — room ${code}`, url: link }).catch(() => {}) }) : null),
        el('h4', { textContent: guests.size ? 'Players' : 'Waiting for players…' }),
        ...[...guests.entries()].map(([pid, g]) => el('div', { className: 'net-guest' },
          el('span', { textContent: `${g.name}${g.ping ? ` · ${g.ping} ms` : ''}` }),
          el('select', { onchange: (e) => setSlot(pid, Number(e.target.value)) },
            ...[...Array(Math.max(1, H.maxP())).keys()].map((s) => el('option', { value: s, textContent: slotName(s), selected: g.slot === s })),
            el('option', { value: -1, textContent: 'Watching', selected: g.slot < 0 })),
          el('button', { className: 'ghost', textContent: '✕', title: 'Remove', onclick: () => kick(pid) }))),
        lastErr ? el('p', { className: 'err', textContent: '⚠ ' + lastErr }) : null,
        el('button', { id: 'net-stop', className: 'ghost', textContent: 'Stop hosting', onclick: stop }));
    }
    box.replaceChildren(...kids.filter(Boolean));
  };
  redraw();
  return box;
}
const noop = () => {};

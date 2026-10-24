// Online play settings, shared by the host (player.html) and the guest page (join.html).
// Signalling (who connects to whom) goes through a PeerJS server; the game video, sound and inputs then go
// directly between the two devices over WebRTC (peer-to-peer). STUN finds a direct route; TURN relays when none exists.
const KEY = 'rp.net';
export const DEFAULT_STUN = 'stun:stun.l.google.com:19302, stun:stun.cloudflare.com:3478';
export const DEFAULTS = { server: '', stun: DEFAULT_STUN, turnUrl: '', turnUser: '', turnPass: '', name: '' };
export const loadNet = () => { try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return { ...DEFAULTS }; } };
export const saveNet = (c) => localStorage.setItem(KEY, JSON.stringify({ ...DEFAULTS, ...c }));
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // no 0/O/1/I
export const newCode = (n = 6) => { const a = crypto.getRandomValues(new Uint8Array(n)); return [...a].map((x) => CODE_CHARS[x % CODE_CHARS.length]).join(''); };
export const cleanCode = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
export const peerId = (code) => 'rp-' + cleanCode(code).toLowerCase();

/** Parse "https://my-server.onrender.com/rp" / "my-server.fly.dev" / "http://192.168.1.20:9000" into PeerJS options; '' = public PeerJS cloud. */
export function parseServer(s) {
  s = String(s || '').trim(); if (!s) return null;
  if (!/^[a-z]+:\/\//i.test(s)) s = (/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(s) ? 'http://' : 'https://') + s;
  const u = new URL(s), secure = u.protocol === 'https:' || u.protocol === 'wss:';
  return { host: u.hostname, port: Number(u.port) || (secure ? 443 : 80), path: (u.pathname.replace(/\/+$/, '') || '') + '/', secure };
}
export function iceServers(c = loadNet()) {
  const list = String(c.stun || '').split(/[\s,]+/).filter(Boolean).map((urls) => ({ urls }));
  if (c.turnUrl) list.push({ urls: String(c.turnUrl).split(/[\s,]+/).filter(Boolean), username: c.turnUser || undefined, credential: c.turnPass || undefined });
  return list;
}
export function peerOptions(c = loadNet()) {
  const o = { config: { iceServers: iceServers(c) }, debug: Number(localStorage.getItem('rp.netdebug')) || 1 };
  const srv = parseServer(c.server); if (srv) Object.assign(o, srv);
  return o;
}
export const serverLabel = (c = loadNet()) => (c.server ? parseServer(c.server).host : 'public PeerJS server (0.peerjs.com)');

let peerLib = null;
/** Load the vendored PeerJS client (MIT) once. */
export function loadPeer(base = '') {
  if (window.Peer) return Promise.resolve(window.Peer);
  if (window.peerjs && window.peerjs.Peer) return Promise.resolve(window.peerjs.Peer);
  return peerLib || (peerLib = new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = base + 'vendor/peerjs.min.js';
    s.onload = () => res(window.Peer || (window.peerjs && window.peerjs.Peer)); s.onerror = () => { peerLib = null; rej(new Error('Could not load the online-play library')); };
    document.head.appendChild(s);
  }));
}

/** EmulatorJS input ids (simulateInput): 0 B, 1 Y, 2 SELECT, 3 START, 4 UP, 5 DOWN, 6 LEFT, 7 RIGHT, 8 A, 9 X, 10 L, 11 R, 12 L2, 13 R2, 14 L3, 15 R3, 16-19 left stick, 20-23 right stick. */
export const BTN = { B: 0, Y: 1, SELECT: 2, START: 3, UP: 4, DOWN: 5, LEFT: 6, RIGHT: 7, A: 8, X: 9, L: 10, R: 11, L2: 12, R2: 13, L3: 14, R3: 15 };
/** standard-mapping Gamepad API button index -> EmulatorJS id (Nintendo layout: bottom = B, right = A) */
export const PAD_TO_EJS = { 0: 0, 1: 8, 2: 1, 3: 9, 4: 10, 5: 11, 6: 12, 7: 13, 8: 2, 9: 3, 10: 14, 11: 15, 12: 4, 13: 5, 14: 6, 15: 7 };
export const KEY_TO_EJS = { ArrowUp: 4, ArrowDown: 5, ArrowLeft: 6, ArrowRight: 7, KeyX: 8, KeyZ: 0, KeyS: 9, KeyA: 1, KeyQ: 10, KeyW: 11, Enter: 3, ShiftRight: 2, ShiftLeft: 2, Backspace: 2 };

// Guest side of online play: watch the host's game stream and control your player with touch, keyboard or a controller.
import { loadNet, saveNet, peerOptions, peerId, cleanCode, loadPeer, serverLabel, PAD_TO_EJS, KEY_TO_EJS, BTN } from './netcfg.js';

const $ = (s) => document.querySelector(s);
const q = new URLSearchParams(location.search);
let cfg = loadNet();
if (q.get('srv') != null) cfg = { ...cfg, server: q.get('srv') };       // the host's link carries a self-hosted server address
let peer = null, conn = null, pingT = 0, myLabel = '', title = '';
const state = new Map();      // id -> value currently sent

$('#code').value = cleanCode(q.get('room') || '');
$('#name').value = cfg.name || '';
$('#srvinfo').textContent = `Server: ${serverLabel(cfg)}`;
const showErr = (m) => { const e = $('#jerr'); e.textContent = m; e.hidden = !m; };
const info = (m) => { $('#info').textContent = m; };
const overlay = (m) => { const o = $('#overlay'); o.textContent = m || ''; o.hidden = !m; };

function send(id, v) {
  if ((state.get(id) || 0) === v) return;
  if (v) state.set(id, v); else state.delete(id);
  try { conn && conn.open && conn.send({ t: 'in', i: id, v }); } catch {}
}
function releaseAll() { for (const id of [...state.keys()]) send(id, 0); }

async function join(code) {
  code = cleanCode(code); if (!code) return showErr('Enter the room code');
  showErr(''); $('#join').disabled = true; $('#join').textContent = 'Connecting…';
  saveNet({ ...loadNet(), name: $('#name').value.trim() });
  try {
    const Peer = await loadPeer();
    peer = new Peer(undefined, peerOptions(cfg));
    await new Promise((res, rej) => { peer.on('open', res); peer.on('error', rej); setTimeout(() => rej(new Error('timeout')), 15000); });
  } catch (e) { $('#join').disabled = false; $('#join').textContent = 'Join'; return showErr(`Could not reach the online-play server (${serverLabel(cfg)}): ${e.type || e.message}`); }
  peer.on('error', (e) => {
    if (e.type === 'peer-unavailable') { leave(false); showErr(`Room ${code} not found. Check the code — the host must keep the game open with the room started.`); }
    else console.warn('peer', e);
  });
  peer.on('call', (call) => {
    call.answer();
    call.on('stream', (s) => { const v = $('#screen'); v.srcObject = s; v.play().catch(() => {}); overlay(''); window.__rpGotStream = true; });
    call.on('close', () => overlay('Stream ended'));
  });
  conn = peer.connect(peerId(code), { reliable: true, serialization: 'json', metadata: { name: $('#name').value.trim() || 'Guest' } });
  conn.on('open', () => {
    $('#joinform').hidden = true; $('#stage').hidden = false; overlay('Waiting for the game stream…');
    history.replaceState(null, '', `?room=${code}${q.get('srv') ? '&srv=' + encodeURIComponent(q.get('srv')) : ''}`);
    clearInterval(pingT); pingT = setInterval(() => { try { conn.send({ t: 'ping', ts: performance.now() }); } catch {} }, 2000);
  });
  conn.on('data', (d) => {
    if (!d || typeof d !== 'object') return;
    if (d.t === 'hello') { title = d.title; myLabel = d.label; info(`${title} · ${myLabel}`); if (d.paused) overlay('Host paused the game'); }
    else if (d.t === 'slot') { myLabel = d.label; info(`${title} · ${myLabel}`); releaseAll(); }
    else if (d.t === 'pong') { const ms = Math.round(performance.now() - d.ts); info(`${title} · ${myLabel} · ${ms} ms`); try { conn.send({ t: 'rtt', ms }); } catch {} window.__rpPing = ms; }
    else if (d.t === 'paused') overlay(d.paused ? 'Host paused the game' : '');
    else if (d.t === 'ended') { overlay('The host ended the session'); releaseAll(); }
    else if (d.t === 'kicked') { overlay('The host removed you from the room'); }
    else if (d.t === 'error') overlay('Host: ' + d.msg);
  });
  conn.on('close', () => { overlay('Disconnected from the host'); clearInterval(pingT); });
  setTimeout(() => { if (conn && !conn.open && !$('#jerr').textContent) { leave(false); showErr('No answer from that room. Check the code, or (on very strict networks) add a TURN server in Settings → Online play.'); } }, 20000);
}
function leave(goHome = true) {
  releaseAll(); clearInterval(pingT);
  try { conn && conn.close(); peer && peer.destroy(); } catch {}
  conn = null; peer = null;
  $('#join').disabled = false; $('#join').textContent = 'Join';
  if (goHome) { $('#stage').hidden = true; $('#joinform').hidden = false; }
  else { $('#stage').hidden = true; $('#joinform').hidden = false; }
}
$('#joinform').addEventListener('submit', (e) => { e.preventDefault(); join($('#code').value); });
$('#leave').onclick = () => leave(true);
$('#sound').onclick = () => { const v = $('#screen'); v.muted = !v.muted; v.play().catch(() => {}); $('#sound').textContent = v.muted ? '🔇 Tap for sound' : '🔊'; };
const coarse = matchMedia('(pointer: coarse)').matches;
if (!coarse) document.body.classList.add('nopad');
$('#padtoggle').onclick = () => document.body.classList.toggle('nopad');

/* touch buttons (multi-touch: each pointer owns what it pressed) */
const owned = new Map();     // pointerId -> Set(ids)
function setOwned(pid, ids) {
  const before = owned.get(pid) || new Set();
  for (const id of before) if (!ids.has(id)) { send(id, 0); mark(id, false); }
  for (const id of ids) if (!before.has(id)) { send(id, 1); mark(id, true); }
  if (ids.size) owned.set(pid, ids); else owned.delete(pid);
}
function mark(id, on) {
  const d = { 4: '.u', 5: '.d', 6: '.l', 7: '.r' }[id];
  const e = d ? $('#dpad ' + d) : document.querySelector(`#tpad button[data-id="${id}"]`); if (e) e.classList.toggle('on', on);
}
function idsAt(x, y) {
  const ids = new Set(), dp = $('#dpad').getBoundingClientRect();
  if (x >= dp.left - 20 && x <= dp.right + 20 && y >= dp.top - 20 && y <= dp.bottom + 20) {
    const dx = x - (dp.left + dp.width / 2), dy = y - (dp.top + dp.height / 2), dead = dp.width * 0.12;
    if (Math.abs(dx) > dead && Math.abs(dx) > Math.abs(dy) * 0.45) ids.add(dx < 0 ? BTN.LEFT : BTN.RIGHT);
    if (Math.abs(dy) > dead && Math.abs(dy) > Math.abs(dx) * 0.45) ids.add(dy < 0 ? BTN.UP : BTN.DOWN);
    return ids;
  }
  const b = document.elementFromPoint(x, y); const btn = b && b.closest && b.closest('#tpad button[data-id]');
  if (btn) ids.add(Number(btn.dataset.id));
  return ids;
}
const tpad = $('#tpad');
tpad.addEventListener('pointerdown', (e) => { if (!e.target.closest('button,[data-dpad]')) return; e.preventDefault(); setOwned(e.pointerId, idsAt(e.clientX, e.clientY)); });
addEventListener('pointermove', (e) => { if (owned.has(e.pointerId)) setOwned(e.pointerId, idsAt(e.clientX, e.clientY)); });
for (const t of ['pointerup', 'pointercancel']) addEventListener(t, (e) => { if (owned.has(e.pointerId)) setOwned(e.pointerId, new Set()); });

/* keyboard */
addEventListener('keydown', (e) => { if ($('#stage').hidden) return; const id = KEY_TO_EJS[e.code]; if (id == null) return; e.preventDefault(); send(id, 1); });
addEventListener('keyup', (e) => { const id = KEY_TO_EJS[e.code]; if (id != null) send(id, 0); });
addEventListener('blur', releaseAll);

/* controllers (Gamepad API, standard mapping) */
const padHeld = new Set();
function pollPads() {
  requestAnimationFrame(pollPads);
  if (!conn || !navigator.getGamepads) return;
  const now = new Map();
  for (const g of navigator.getGamepads()) {
    if (!g) continue;
    g.buttons.forEach((b, i) => { const id = PAD_TO_EJS[i]; if (id != null && (b.pressed || b.value > 0.5)) now.set(id, 1); });
    const ax = (i) => (Math.abs(g.axes[i] || 0) > 0.2 ? g.axes[i] : 0), q8 = (v) => Math.round(v * 8) / 8 * 32767;
    const lx = ax(0), ly = ax(1), rx = ax(2), ry = ax(3);
    if (lx > 0) now.set(16, q8(lx)); if (lx < 0) now.set(17, q8(-lx)); if (ly > 0) now.set(18, q8(ly)); if (ly < 0) now.set(19, q8(-ly));
    if (rx > 0) now.set(20, q8(rx)); if (rx < 0) now.set(21, q8(-rx)); if (ry > 0) now.set(22, q8(ry)); if (ry < 0) now.set(23, q8(-ry));
  }
  for (const id of padHeld) if (!now.has(id)) { send(id, 0); padHeld.delete(id); }
  for (const [id, v] of now) { send(id, v); padHeld.add(id); }
}
requestAnimationFrame(pollPads);

if ($('#code').value && q.get('auto') !== '0' && $('#name').value) join($('#code').value);
else if ($('#code').value) $('#name').focus();

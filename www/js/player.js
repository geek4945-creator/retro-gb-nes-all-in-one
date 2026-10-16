// Launches EmulatorJS (RetroArch cores compiled to WebAssembly) for one ROM from the IndexedDB library,
// guards the core against crashes and keeps resumable snapshots.
import * as db from './db.js';
import { EJS_CDN, SYSTEMS, CORE_LABELS, altCore } from './cores.js';

// Where EmulatorJS' loader, UI and cores come from: a PINNED release (see EJS_VERSION in cores.js), not "stable".
// Override with window.RP_EJS_DATA for a self-hosted copy (README → Self-hosting EmulatorJS).
export const EJS_DATA = window.RP_EJS_DATA || EJS_CDN;

const params = new URLSearchParams(location.search);
const id = params.get('id');
const $ = (s) => document.querySelector(s);
const status = $('#status');
const fail = (msg) => { status.hidden = false; status.classList.add('err'); status.textContent = msg; };

const FLUSH_MS = 60_000;      // battery-save flush (only while the game is running in the foreground)
const SNAP_MS = 90_000;       // auto-resume snapshot (not for DS: states are large, exit/background snapshots only)
const STALL_MS = 12_000;      // no new frame for this long while running in the foreground == hung core
const EARLY_MS = 15_000;      // a crash this soon after start triggers the automatic core fallback
const CRASH_RE = /abort|RuntimeError|unreachable|memory access out of bounds|table index is out of bounds|null function|signature mismatch|Cannot enlarge memory|out of memory|integer divide by zero|stack overflow|invalid atomic/i;

let rom = null, started = false, startedAt = 0, crashed = false, leaving = false;
let lastFrame = -1, lastFrameAt = 0, lastPersist = 0;
const emu = () => window.EJS_emulator;
const running = () => { const e = emu(); return started && !crashed && e && !e.paused && document.visibilityState === 'visible'; };

/* ---------- saving ---------- */
function flushSaves() {            // in-game (battery) saves; never while hidden/paused/crashed, never throws
  if (!running()) return;
  try { emu().gameManager.saveSaveFiles(); } catch (e) { console.warn('saveSaveFiles', e); }
}
async function snapshot({ force = false } = {}) {
  const e = emu();
  if (!e || !started || crashed || !e.gameManager || !rom) return;
  if (!force && !running()) return;
  if (Date.now() - lastPersist < 4000) return;
  lastPersist = Date.now();
  try { e.gameManager.saveSaveFiles(); } catch (x) { console.warn('saveSaveFiles', x); }
  try {
    // JS is single-threaded and the core only advances inside its own animation-frame callback, so this never
    // runs mid-frame. getState() returns a view into the wasm heap: copy it out immediately.
    const state = e.gameManager.getState();
    if (state && state.length) await db.putState({ id: rom.id, core: rom.core, data: state.slice().buffer, time: Date.now() });
  } catch (x) { console.warn('snapshot', x); }
}
setInterval(flushSaves, FLUSH_MS);
setInterval(() => { if (rom && rom.system !== 'nds') snapshot(); }, SNAP_MS);

/* ---------- crash handling ---------- */
function crashScreen(reason, detail) {
  if (crashed) return; crashed = true; window.__rpCrashed = true;
  console.error('Core crash:', reason, detail || '');
  try { emu() && emu().pause && emu().pause(true); } catch {}
  try { const a = emu() && emu().Module && emu().Module.AL && emu().Module.AL.currentCtx; a && a.audioCtx && a.audioCtx.suspend(); } catch {}
  status.hidden = true;
  const box = $('#crash'); box.hidden = false;
  $('#crash-msg').textContent = `${rom ? rom.title : 'This game'} stopped unexpectedly (core: ${rom ? CORE_LABELS[rom.core] || rom.core : '?'}).`;
  $('#crash-detail').textContent = String(reason || '').slice(0, 300);
  db.getState(id).then((st) => {
    const ok = st && st.core === rom.core && st.data;
    $('#crash-resume').hidden = !ok;
    if (ok) $('#crash-resume').textContent = `Resume from last auto-save (${new Date(st.time).toLocaleTimeString()})`;
  }).catch(() => {});
  const alt = rom && altCore(rom.system, rom.core);
  const altBtn = $('#crash-alt'); altBtn.hidden = !alt;
  if (alt) altBtn.textContent = `Try another core: ${CORE_LABELS[alt] || alt}`;
  if (rom) { rom.crashes = (rom.crashes || 0) + 1; rom.lastCrash = Date.now(); db.putRom(rom).catch(() => {}); }
}

async function switchCore() {
  const alt = altCore(rom.system, rom.core); if (!alt) return;
  rom.core = alt; await db.putRom(rom); await db.deleteState(rom.id).catch(() => {});
  location.replace(`player.html?id=${encodeURIComponent(rom.id)}&switched=1`);
}
function onFault(reason, detail) {
  if (crashed || leaving) return;
  const early = !started || Date.now() - startedAt < EARLY_MS;
  const key = 'rp.fb.' + id;
  if (early && rom && altCore(rom.system, rom.core) && !sessionStorage.getItem(key)) {
    sessionStorage.setItem(key, '1');                   // automatic fallback, once per session, to avoid loops
    rom.crashes = (rom.crashes || 0) + 1;
    console.warn('Early core failure, falling back to', altCore(rom.system, rom.core), reason);
    switchCore(); return;
  }
  crashScreen(reason, detail);
}
addEventListener('error', (e) => { const m = (e.error && e.error.message) || e.message || ''; if (CRASH_RE.test(m)) onFault(m); });
addEventListener('unhandledrejection', (e) => { const m = (e.reason && e.reason.message) || String(e.reason || ''); if (CRASH_RE.test(m)) onFault(m); });

setInterval(() => {                 // watchdog: the frame counter must keep advancing while we are running in the foreground
  if (!running()) { lastFrameAt = Date.now(); return; }
  let f = -1; try { f = emu().gameManager.getFrameNum(); } catch (e) { return onFault('core not responding: ' + e.message); }
  if (f !== lastFrame) { lastFrame = f; lastFrameAt = Date.now(); }
  else if (Date.now() - lastFrameAt > STALL_MS) onFault('core stopped producing frames');
}, 2000);

$('#crash-restart').onclick = () => { sessionStorage.removeItem('rp.fb.' + id); location.replace(`player.html?id=${encodeURIComponent(id)}`); };
$('#crash-resume').onclick = () => location.replace(`player.html?id=${encodeURIComponent(id)}&resume=1`);
$('#crash-alt').onclick = switchCore;
$('#crash-lib').onclick = () => { location.href = 'index.html'; };

/* ---------- navigation / lifecycle ---------- */
$('#back').addEventListener('click', async () => {
  if (leaving) return; leaving = true;
  status.hidden = false; status.textContent = 'Saving…';
  await Promise.race([snapshot({ force: true }), new Promise((r) => setTimeout(r, 2500))]);
  location.href = 'index.html';
});
function resumeAudio() {
  try { const a = emu().Module.AL.currentCtx.audioCtx; if (a && a.state !== 'running') a.resume(); } catch {}   // iOS suspends audio on background
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') snapshot({ force: true }); else { lastFrameAt = Date.now(); resumeAudio(); }
});
addEventListener('pagehide', () => snapshot({ force: true }));
addEventListener('pointerdown', resumeAudio, { passive: true });

/* ---------- boot ---------- */
(async () => {
  if (!id) return fail('No game selected.');
  rom = await db.getRom(id);
  if (!rom) return fail('Game not found in your library.');
  document.title = rom.title;
  rom.lastPlayed = Date.now(); db.putRom(rom).catch(() => {});
  if (params.get('switched')) { const b = $('#banner'); b.textContent = `Switched to ${CORE_LABELS[rom.core] || rom.core} after a problem with the previous core.`; b.hidden = false; setTimeout(() => (b.hidden = true), 6000); }

  const file = new File([rom.data], rom.file, { type: 'application/octet-stream' });
  window.EJS_player = '#game';
  window.EJS_core = rom.core;
  window.EJS_gameUrl = file;
  window.EJS_gameName = rom.title;
  window.EJS_gameID = rom.id;
  window.EJS_pathtodata = EJS_DATA;
  window.EJS_color = '#7c5cff';
  window.EJS_backgroundColor = '#000000';
  window.EJS_startOnLoaded = false;            // keep EmulatorJS' tap-to-start button: iOS needs a user gesture for audio
  window.EJS_threads = false;                  // single-threaded cores (incl. DS): no COOP/COEP headers / SharedArrayBuffer needed
  window.EJS_language = 'en-US';
  window.EJS_defaultOptions = {
    'save-state-location': 'browser',          // keep manual save states inside the browser, not downloads
    'save-save-interval': '0',                 // we flush battery saves ourselves (guarded, see flushSaves)
    'virtual-gamepad': 'enabled',
  };
  window.EJS_ready = () => { status.hidden = true; };
  window.EJS_onGameStart = () => { started = true; startedAt = Date.now(); lastFrameAt = Date.now(); status.hidden = true; };

  if (params.get('resume') === '1') {
    const st = await db.getState(rom.id);
    // never load a snapshot taken by a different core: that is a classic way to crash a libretro core
    if (st && st.data && st.core === rom.core) window.EJS_loadStateURL = URL.createObjectURL(new Blob([st.data]));
  }

  status.textContent = 'Loading emulator…';
  const s = document.createElement('script');
  s.src = EJS_DATA + 'loader.js';
  s.onerror = () => fail('Could not load the emulator. Check your internet connection (needed the first time).');
  document.body.appendChild(s);
})().catch((e) => { console.error(e); fail('Error: ' + e.message); });

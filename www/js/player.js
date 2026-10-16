// Launches EmulatorJS (RetroArch cores compiled to WebAssembly) for one ROM from the IndexedDB library.
import * as db from './db.js';

// Where EmulatorJS' loader, UI and cores come from. Change to a self-hosted copy if you prefer
// (see README → "Self-hosting EmulatorJS"). The service worker caches whatever is fetched from here.
export const EJS_DATA = (window.RP_EJS_DATA) || 'https://cdn.emulatorjs.org/stable/data/';

const params = new URLSearchParams(location.search);
const id = params.get('id');
const status = document.getElementById('status');
const fail = (msg) => { status.hidden = false; status.classList.add('err'); status.textContent = msg; };

let rom = null, started = false, leaving = false;

async function persistSession() {
  const emu = window.EJS_emulator;
  if (!emu || !started || !emu.gameManager) return;
  try { emu.gameManager.saveSaveFiles(); } catch (e) { console.warn('saveSaveFiles', e); }
  try {
    const state = emu.gameManager.getState();           // Uint8Array view into wasm heap
    if (state && state.length) {
      const copy = state.slice().buffer;
      await db.putState({ id: rom.id, data: copy, time: Date.now() });
    }
  } catch (e) { console.warn('auto-state', e); }
}

document.getElementById('back').addEventListener('click', async () => {
  if (leaving) return; leaving = true;
  status.hidden = false; status.textContent = 'Saving…';
  await Promise.race([persistSession(), new Promise((r) => setTimeout(r, 2500))]);
  location.href = 'index.html';
});
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') persistSession(); });
addEventListener('pagehide', () => { persistSession(); });

(async () => {
  if (!id) return fail('No game selected.');
  rom = await db.getRom(id);
  if (!rom) return fail('Game not found in your library.');
  document.title = rom.title;
  rom.lastPlayed = Date.now(); db.putRom(rom).catch(() => {});

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
  window.EJS_threads = false;                  // single-threaded cores: no COOP/COEP headers needed
  window.EJS_language = 'en-US';
  window.EJS_defaultOptions = {
    'save-state-location': 'browser',          // keep manual save states inside the browser, not downloads
    'save-save-interval': '30',                // flush in-game (battery) saves every 30 s
    'virtual-gamepad': 'enabled',
  };
  window.EJS_ready = () => { status.hidden = true; };
  window.EJS_onGameStart = () => { started = true; status.hidden = true; };

  if (params.get('resume') === '1') {
    const st = await db.getState(rom.id);
    if (st && st.data) window.EJS_loadStateURL = URL.createObjectURL(new Blob([st.data]));
  }

  status.textContent = 'Loading emulator…';
  const s = document.createElement('script');
  s.src = EJS_DATA + 'loader.js';
  s.onerror = () => fail('Could not load the emulator. Check your internet connection (needed the first time).');
  document.body.appendChild(s);
})().catch((e) => { console.error(e); fail('Error: ' + e.message); });

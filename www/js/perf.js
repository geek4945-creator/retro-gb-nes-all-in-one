// Settings → Performance & device: what this phone / computer can do, and graphics presets mapped to real
// EmulatorJS 4.2.3 core options (option names and values checked against the 4.2.3 core builds).
//
//   Auto (recommended) picks Fast / Balanced / Best looking from the device info below and says why.
//   A per-game choice (game sheet → Graphics) wins over the global one, and anything you change for one game in
//   EmulatorJS' own ⚙ Emulator settings menu wins over both (see reconcileSaved).
//
// Works in the iPhone PWA (Safari exposes cores, screen and WebGL; it hides RAM and the GPU model, which we say),
// Android Chrome, desktop browsers and the Android app — the app adds the phone model, chipset (Android 12+), Android
// version and total RAM through the native DeviceInfo plugin (android/app/src/main/java/.../DeviceInfoPlugin.java).

const KEY = 'rp.perf', GAME_KEY = 'rp.perf.games', APPLIED_KEY = 'rp.perf.applied';
export const PRESETS = {
  fast: { label: 'Fast (smoothest)', short: 'Fast', blurb: 'Lowest internal resolution and frame skipping on heavy 3D systems, no screen filter, no rewind.' },
  balanced: { label: 'Balanced', short: 'Balanced', blurb: 'Native-style resolution, no frame skipping. Rewind only on light systems.' },
  best: { label: 'Best looking', short: 'Best looking', blurb: 'Higher internal resolution on N64 / PlayStation / PSP and a CRT or LCD screen filter on 2D systems.' },
};
export const MODES = ['auto', 'fast', 'balanced', 'best'];

const read = (k, d) => { try { return JSON.parse(localStorage.getItem(k) || 'null') ?? d; } catch { return d; } };
export const loadPerf = () => ({ mode: 'auto', ...read(KEY, {}) });
export const savePerf = (p) => localStorage.setItem(KEY, JSON.stringify(p));
export const gamePreset = (id) => (id != null && read(GAME_KEY, {})[id]) || '';
export function setGamePreset(id, preset) { const g = read(GAME_KEY, {}); if (PRESETS[preset]) g[id] = preset; else delete g[id]; localStorage.setItem(GAME_KEY, JSON.stringify(g)); }

/* ---------------- preset → options ---------------- */
// Core options (libretro keys). Only the cores that have such options are listed; everything else just gets the
// generic part (screen filter / rewind). Nintendo DS (melonDS 0.9.3 / DeSmuME 2015 in EmulatorJS 4.2.3) exposes no
// resolution or frame-skip option, so DS only follows the generic part.
export const CORE_OPTIONS = {
  fast: {
    'mupen64plus-43screensize': '320x240', 'mupen64plus-FrameDuping': 'True',                  // N64 (default core)
    'parallel-n64-screensize': '320x240',                                                     // N64 (alternate core)
    'pcsx_rearmed_frameskip_type': 'auto',                                                    // PlayStation
    'beetle_psx_hw_internal_resolution': '1x(native)',
    'ppsspp_internal_resolution': '480x272', 'ppsspp_auto_frameskip': 'enabled', 'ppsspp_frameskip': '1',   // PSP
  },
  balanced: {
    'mupen64plus-43screensize': '640x480', 'mupen64plus-FrameDuping': 'False',
    'parallel-n64-screensize': '640x480',
    'pcsx_rearmed_frameskip_type': 'disabled',
    'beetle_psx_hw_internal_resolution': '1x(native)',
    'ppsspp_internal_resolution': '480x272', 'ppsspp_auto_frameskip': 'disabled', 'ppsspp_frameskip': 'disabled',
  },
  best: {
    'mupen64plus-43screensize': '960x720', 'mupen64plus-FrameDuping': 'False',
    'parallel-n64-screensize': '640x480',
    'pcsx_rearmed_frameskip_type': 'disabled',
    'beetle_psx_hw_internal_resolution': '2x',
    'ppsspp_internal_resolution': '960x544', 'ppsspp_auto_frameskip': 'disabled', 'ppsspp_frameskip': 'disabled',
  },
};
const HANDHELD = new Set(['gb', 'gbc', 'gba', 'gg', 'ngp', 'ngpc', 'ws', 'wsc', 'lynx']);
const CONSOLE_2D = new Set(['nes', 'snes', 'md', 'sms', 'pce', 'sg1000', 'a2600', 'a7800', 'coleco', 'segaCD', 'sega32x', 'arcade', 'mame', 'fbneo']);
const LIGHT = new Set(['nes', 'snes', 'gb', 'gbc', 'gba', 'sms', 'gg', 'sg1000', 'md', 'pce', 'a2600', 'a7800', 'lynx', 'ngp', 'ngpc', 'ws', 'wsc', 'vb', 'coleco']);
/** Default screen filter (video.js FILTERS key) when you have not picked one for this system in the ☰ menu. */
export function presetFilter(preset, sys) {
  if (preset !== 'best') return 'off';
  return HANDHELD.has(sys) ? 'lcd' : CONSOLE_2D.has(sys) ? 'crt' : 'off';
}
/** Default rewind when you have not switched it for this system in the ☰ menu (rewind = a save state every frame). */
export const presetRewind = (preset, sys) => preset !== 'fast' && LIGHT.has(sys);
/** EmulatorJS setting values for this preset (EJS_defaultOptions). VSync stays on: off causes tearing / uneven pacing in browsers. */
export function presetOptions(preset) { return { vsync: 'enabled', ...(CORE_OPTIONS[preset] || CORE_OPTIONS.balanced) }; }

// The cores' own defaults (= Balanced). A saved value equal to these was not picked by you.
const CORE_DEFAULTS = { vsync: 'enabled', ...CORE_OPTIONS.balanced, 'mupen64plus-FrameDuping': 'False' };

/* ---------------- device info ---------------- */
export function webglInfo() {
  const out = { webgl: false, webgl2: false, renderer: '', vendor: '', maxTexture: 0 };
  try {
    const c = document.createElement('canvas');
    out.webgl2 = !!c.getContext('webgl2');
    const gl = document.createElement('canvas').getContext('webgl') || document.createElement('canvas').getContext('experimental-webgl');
    if (gl) {
      out.webgl = true; out.maxTexture = gl.getParameter(gl.MAX_TEXTURE_SIZE) || 0;
      const dbg = gl.getExtension('WEBGL_debug_renderer_info');
      out.renderer = String(dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER) || '');
      out.vendor = String(dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR) || '');
      const lose = gl.getExtension('WEBGL_lose_context'); if (lose) lose.loseContext();
    }
  } catch {}
  return out;
}
/** Screen refresh rate from requestAnimationFrame timing (≈ 60 / 90 / 120 Hz). */
export function measureRefresh(ms = 600) {
  return new Promise((res) => {
    if (typeof requestAnimationFrame !== 'function') return res(0);
    const t = []; const t0 = performance.now();
    const f = (now) => { t.push(now); if (now - t0 < ms) requestAnimationFrame(f); else done(); };
    const done = () => { const d = t.slice(1).map((x, i) => x - t[i]).sort((a, b) => a - b); const med = d[Math.floor(d.length / 2)] || 0; res(med ? Math.round(1000 / med) : 0); };
    requestAnimationFrame(f); setTimeout(() => { if (!t.length) res(0); }, ms + 800);   // hidden tab: rAF never fires
  });
}
export async function nativeInfo() {
  try { const p = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.DeviceInfo; return p ? await p.getInfo() : null; } catch { return null; }
}
export const isiOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isAndroid = () => /android/i.test(navigator.userAgent);
export async function deviceInfo({ refresh = true } = {}) {
  const gl = webglInfo();
  const nat = await nativeInfo();
  return {
    cores: navigator.hardwareConcurrency || 0,
    ramGB: navigator.deviceMemory || 0,                       // Chrome / Android only, rounded and capped at 8 by the browser
    ...gl,
    screen: { w: Math.round(screen.width * (devicePixelRatio || 1)), h: Math.round(screen.height * (devicePixelRatio || 1)), dpr: devicePixelRatio || 1, cssW: screen.width, cssH: screen.height },
    refresh: refresh ? await measureRefresh() : 0,
    platform: nat ? 'android-app' : isiOS() ? 'ios' : isAndroid() ? 'android' : 'desktop',
    native: nat,                                              // { model, manufacturer, soc, socManufacturer, android, sdk, totalRamMB, memoryClassMB, lowRam }
  };
}

/* ---------------- benchmark ---------------- */
// Single-thread CPU score (what emulator cores mostly depend on): integer + float work similar to an interpreter loop.
// About 1 s. Roughly: < 300 low-end phone, 300–700 mid-range, > 700 flagship phone / computer.
export function benchmark(ms = 1000) {
  return new Promise((res) => {
    let iters = 0, acc = 1, mem = new Int32Array(4096);
    const t0 = performance.now();
    const chunk = () => {
      const end = performance.now() + 50;
      while (performance.now() < end) {
        for (let i = 0; i < 20000; i++) { const a = mem[(i * 7) & 4095]; acc = (acc * 1103515245 + 12345 + a) | 0; mem[i & 4095] = acc ^ (acc >>> 7); acc += Math.sqrt(i & 1023) | 0; }
        iters++;
      }
      if (performance.now() - t0 < ms) setTimeout(chunk, 0); else res({ score: Math.round(iters / ((performance.now() - t0) / 1000) / 2), at: Date.now(), check: acc & 1 });
    };
    setTimeout(chunk, 0);
  });
}

/* ---------------- Auto ---------------- */
const WEAK_GPU = /Mali-(4\d\d|T6\d\d|T7\d\d|T8\d\d|G31|G51|G52)|Adreno \(TM\) ([2-5]\d\d|60\d|61\d)|PowerVR (SGX|Rogue G[EX]?\d{4})|GE8\d{3}|IMG BXE|Vivante|Tegra 3|SwiftShader|llvmpipe|Software/i;
const STRONG_GPU = /Adreno \(TM\) (7[3-9]\d|8\d\d)|Mali-G7[1-9]|Mali-G[6-9]1\d|Immortalis|Xclipse|Apple (M\d|A1[5-9])|NVIDIA|GeForce|Radeon|Intel\(R\) (Arc|Iris)/i;
/** Pick a tier and explain why. Returns { tier, reasons: [...] }. */
export function autoTier(info, bench = null) {
  const why = [], ramGB = info.native && info.native.totalRamMB ? info.native.totalRamMB / 1024 : info.ramGB || 0;
  const mobile = info.platform !== 'desktop';
  let weak = 0, strong = 0;
  if (info.native && info.native.lowRam) { weak += 2; why.push('Android reports a low-RAM device'); }
  if (info.cores && info.cores <= 4) { weak++; why.push(`${info.cores} CPU cores`); } else if (info.cores >= 8) { strong++; why.push(`${info.cores} CPU cores`); }
  if (ramGB) { if (ramGB <= 3.2) { weak++; why.push(`${ramGB.toFixed(ramGB < 10 ? 1 : 0)} GB RAM`); } else if (ramGB >= 7.5) { strong++; why.push(`${Math.round(ramGB)} GB RAM`); } }
  if (!info.webgl2) { weak += 2; why.push('no WebGL2 (older graphics path)'); }
  const gpu = info.renderer || '';
  if (WEAK_GPU.test(gpu)) { weak += 2; why.push(`entry-level GPU (${gpu.replace(/^ANGLE \((.*)\)$/, '$1').slice(0, 40)})`); }
  else if (STRONG_GPU.test(gpu)) { strong += 2; why.push(`fast GPU (${gpu.replace(/^ANGLE \((.*)\)$/, '$1').slice(0, 40)})`); }
  if (bench && bench.score) { if (bench.score < 300) { weak += 2; why.push(`benchmark ${bench.score} (low)`); } else if (bench.score > 700) { strong += 2; why.push(`benchmark ${bench.score} (high)`); } else why.push(`benchmark ${bench.score} (mid)`); }
  let tier = 'balanced';
  if (weak >= 2) tier = 'fast';
  else if (info.platform === 'ios') { tier = 'balanced'; why.push('iPhone / iPad Safari limits memory for web apps, so Balanced is the safe pick'); }
  else if (strong >= 3 || (!mobile && strong >= 2 && weak === 0)) tier = 'best';
  if (!why.length) why.push('no strong signal either way');
  return { tier, reasons: why };
}

/** The preset that applies to a game: per-game choice > global choice > Auto. */
export function effectivePreset(gameId, perf = loadPerf()) {
  const g = gamePreset(gameId); if (g) return { preset: g, source: 'game' };
  if (PRESETS[perf.mode]) return { preset: perf.mode, source: 'global' };
  return { preset: (perf.auto && PRESETS[perf.auto.tier]) ? perf.auto.tier : 'balanced', source: 'auto' };
}

/**
 * EmulatorJS remembers every setting per game (localStorage "ejs-<id>-<system>-<title>-settings") and those saved values beat
 * EJS_defaultOptions on the next launch — so a preset change would never reach a game you have played before. Before
 * launch we rewrite the saved values *we* put there last time; a value that differs from what we wrote was changed by you
 * in ⚙ Emulator settings and is kept (your per-game override wins).
 */
export function reconcileSaved(gameId, title, opts, storage = localStorage) {
  const applied = read(APPLIED_KEY, {}), mine = applied[gameId] || {};
  let changed = 0;
  for (let i = 0; i < storage.length; i++) {
    const k = storage.key(i);
    if (!k || !k.startsWith(`ejs-${gameId}-`) || !k.endsWith('-settings')) continue;
    let o; try { o = JSON.parse(storage.getItem(k)); } catch { continue; }
    if (!o || typeof o.settings !== 'object' || !o.settings) continue;
    for (const [opt, v] of Object.entries(opts)) {
      const cur = o.settings[opt];
      // ours = never saved, the value we wrote last time, or (first time we see this game) the core's own default
      const ours = cur === undefined || (opt in mine ? cur === mine[opt] : cur === CORE_DEFAULTS[opt]);
      if (ours) { if (cur !== v) { o.settings[opt] = v; changed++; } }
      else delete opts[opt];                                   // user's own per-game choice: keep it (and do not record ours)
    }
    storage.setItem(k, JSON.stringify(o));
  }
  applied[gameId] = { ...mine, ...opts };
  try { localStorage.setItem(APPLIED_KEY, JSON.stringify(applied)); } catch {}
  return changed;
}

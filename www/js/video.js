// Screen filters (shaders), rewind and the ⏪ / ⏩ quick buttons next to ☰.
// Settings are per system and live in localStorage, so they are included in Backup.
import { presetFilter, presetRewind } from './perf.js';
const SHADER_KEY = 'rp.shader', REWIND_KEY = 'rp.rewind', QUICK_KEY = 'rp.quick';
// Graphics preset of the running game (Settings → Performance & device): supplies the default filter / rewind for
// systems where you have not picked one yourself in the ☰ menu.
let preset = null;
export function usePreset(p) { preset = p || null; }

// "ejs" is the EmulatorJS shader name. The built-ins come from EmulatorJS' shaders.js; rp-lcd is our own (below).
export const FILTERS = {
  off: { label: 'Off', ejs: 'disabled' },
  crt: { label: 'CRT', ejs: 'crt-zfast' },
  crtcurve: { label: 'CRT (curved)', ejs: 'crt-geom.glslp' },
  lcd: { label: 'LCD grid', ejs: 'rp-lcd' },
  smooth: { label: 'Smooth', ejs: 'bicubic' },
  hq: { label: 'HQ 2×', ejs: '2xScaleHQ.glslp' },
};
// Light cores get rewind by default. On heavy 3D systems the save state per frame costs too much speed and memory.
const REWIND_DEFAULT = new Set(['nes', 'snes', 'gb', 'gbc', 'gba', 'sms', 'gg', 'sg1000', 'md', 'pce', 'a2600', 'a7800', 'lynx', 'ngp', 'ngpc', 'ws', 'wsc', 'vb', 'coleco']);

const read = (k) => { try { return JSON.parse(localStorage.getItem(k) || '{}') || {}; } catch { return {}; } };
const write = (k, sys, v) => { const o = read(k); o[sys] = v; localStorage.setItem(k, JSON.stringify(o)); };

export function loadFilter(sys) { const v = read(SHADER_KEY)[sys]; return FILTERS[v] ? v : preset ? presetFilter(preset, sys) : 'off'; }   // default: sharp pixels unless the preset says otherwise
export function saveFilter(sys, key) { write(SHADER_KEY, sys, FILTERS[key] ? key : 'off'); }
export function nextFilter(key) { const k = Object.keys(FILTERS); return k[(k.indexOf(key) + 1) % k.length]; }
export function applyFilter(emu, key) {
  const f = FILTERS[key] || FILTERS.off;
  if (!emu || !emu.gameManager) return false;
  if (f.ejs !== 'disabled' && !(emu.config.shaders && emu.config.shaders[f.ejs])) return false;   // shader pack missing (e.g. older self-hosted copy)
  try { emu.changeSettingOption('shader', f.ejs); } catch { try { emu.enableShader(f.ejs); } catch { return false; } }
  return true;
}

/** Has the player picked a filter for this system in the ☰ menu (as opposed to the preset default)? */
export const filterChosen = (sys) => !!FILTERS[read(SHADER_KEY)[sys]];
/**
 * Start-of-game filter. EmulatorJS remembers the last shader per game itself, so an explicit choice (even "off") is always
 * applied; a preset default is applied when it is a filter, and a filter an earlier preset put there is removed again.
 */
export function startFilter(emu, sys, gameId) {
  const key = loadFilter(sys), memo = read('rp.perf.filter'), cur = emu && emu.settings ? emu.settings.shader : undefined;
  if (filterChosen(sys) || key !== 'off') {
    write('rp.perf.filter', gameId, filterChosen(sys) ? null : key);
    return key === 'off' && (!cur || cur === 'disabled') ? true : applyFilter(emu, key);
  }
  const last = memo[gameId];
  write('rp.perf.filter', gameId, null);
  if (last && FILTERS[last] && cur === FILTERS[last].ejs) return applyFilter(emu, 'off');
  return true;
}

export function loadRewind(sys) { const v = read(REWIND_KEY)[sys]; return typeof v === 'boolean' ? v : preset ? presetRewind(preset, sys) : REWIND_DEFAULT.has(sys); }
export function saveRewind(sys, on) { write(REWIND_KEY, sys, !!on); }

export function loadQuick() { const v = read(QUICK_KEY).on; return typeof v === 'boolean' ? v : true; }
export function saveQuick(on) { localStorage.setItem(QUICK_KEY, JSON.stringify({ on: !!on })); }

/* ⏪ (hold) and ⏩ (tap) next to ☰. EmulatorJS' own speed inputs: 27 = fast-forward, 28 = rewind. */
export function quickBar({ emu, canRewind, onChange }) {
  const bar = document.createElement('div'); bar.id = 'quick'; bar.hidden = true;
  const mk = (id, txt, label) => { const b = document.createElement('button'); b.id = id; b.type = 'button'; b.setAttribute('aria-label', label); b.innerHTML = `<span>${txt}</span>`; bar.append(b); return b; };
  const rw = mk('q-rew', '⏪', 'Rewind (hold)'), ff = mk('q-ff', '⏩', 'Fast-forward');
  let rewinding = false;
  const setRew = (on) => {
    const e = emu(); if (!e || !e.gameManager || on === rewinding) return;
    rewinding = on; rw.classList.toggle('on', on);
    try { e.gameManager.functions.toggleRewind(on ? 1 : 0); } catch {}
  };
  rw.addEventListener('pointerdown', (ev) => { ev.preventDefault(); ev.stopPropagation(); try { rw.setPointerCapture(ev.pointerId); } catch {} setRew(true); });
  for (const t of ['pointerup', 'pointercancel', 'lostpointercapture']) rw.addEventListener(t, () => setRew(false));
  ff.addEventListener('click', (ev) => {
    ev.stopPropagation(); const e = emu(); if (!e) return;
    try { e.changeSettingOption('fastForward', e.isFastForward ? 'disabled' : 'enabled'); } catch {}
    paint(); onChange && onChange();
  });
  function paint() { const e = emu(); ff.classList.toggle('on', !!(e && e.isFastForward)); rw.hidden = !canRewind(); }
  return { el: bar, paint, show(on) { bar.hidden = !on; paint(); }, stopRewind: () => setRew(false) };
}

/* LCD grid: each emulated pixel gets a thin dark border plus a faint RGB sub-pixel tint, like a handheld screen.
   Uses the RetroArch GLSL format, the same as the EmulatorJS built-ins. */
const LCD_GLSL = `#pragma parameter GRID "LCD grid strength" 0.35 0.0 1.0 0.05
#if defined(VERTEX)
#if __VERSION__ >= 130
#define COMPAT_VARYING out
#define COMPAT_ATTRIBUTE in
#else
#define COMPAT_VARYING varying
#define COMPAT_ATTRIBUTE attribute
#endif
#ifdef GL_ES
#define COMPAT_PRECISION mediump
#else
#define COMPAT_PRECISION
#endif
COMPAT_ATTRIBUTE vec4 VertexCoord;
COMPAT_ATTRIBUTE vec4 TexCoord;
COMPAT_VARYING vec4 TEX0;
uniform mat4 MVPMatrix;
void main() { gl_Position = MVPMatrix * VertexCoord; TEX0.xy = TexCoord.xy; }
#elif defined(FRAGMENT)
#ifdef GL_ES
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
#define COMPAT_PRECISION mediump
#else
#define COMPAT_PRECISION
#endif
#if __VERSION__ >= 130
#define COMPAT_VARYING in
#define COMPAT_TEXTURE texture
out COMPAT_PRECISION vec4 FragColor;
#else
#define COMPAT_VARYING varying
#define FragColor gl_FragColor
#define COMPAT_TEXTURE texture2D
#endif
uniform COMPAT_PRECISION vec2 OutputSize;
uniform COMPAT_PRECISION vec2 TextureSize;
uniform COMPAT_PRECISION vec2 InputSize;
uniform sampler2D Texture;
COMPAT_VARYING vec4 TEX0;
#ifdef PARAMETER_UNIFORM
uniform COMPAT_PRECISION float GRID;
#else
#define GRID 0.35
#endif
void main() {
  vec2 texel = TEX0.xy * TextureSize;
  vec2 cell = fract(texel);
  vec3 col = COMPAT_TEXTURE(Texture, (floor(texel) + 0.5) / TextureSize).rgb;
  // pixels per emulated pixel on screen: fade the grid out when it would be thinner than ~2 screen pixels
  float scale = OutputSize.y / InputSize.y;
  float edge = clamp(scale / 3.0 - 0.33, 0.0, 1.0) * GRID;
  vec2 d = min(cell, 1.0 - cell);
  float border = 1.0 - edge * (1.0 - smoothstep(0.0, 0.12, min(d.x, d.y)));
  float sub = cell.x * 3.0;
  vec3 tint = vec3(sub < 1.0 ? 1.0 : 0.88, (sub >= 1.0 && sub < 2.0) ? 1.0 : 0.88, sub >= 2.0 ? 1.0 : 0.88);
  col *= border * mix(vec3(1.0), tint, edge * 0.5);
  FragColor = vec4(col * 1.06, 1.0);
}
#endif
`;
export const RP_SHADERS = {
  'rp-lcd': { shader: { type: 'text', value: 'shaders = 1\n\nshader0 = rp_lcd.glsl\nfilter_linear0 = false\nscale_type0 = viewport\n' }, resources: [{ name: 'rp_lcd.glsl', type: 'text', value: LCD_GLSL }] },
};

// Physical controller support (Gamepad API): settings, EmulatorJS control maps, and a navigator.getGamepads() shim that
// adds a configurable deadzone, trigger thresholds, hat/D-pad axis decoding, stick->D-pad for digital systems and hotkey masking.
// Works anywhere the Gamepad API does: desktop browsers, iOS/iPadOS Safari 13+ (MFi, Xbox, PlayStation, Switch Pro via Bluetooth),
// Android Chrome and the Capacitor Android WebView (Chromium).

import { SYSTEMS } from './cores.js';
export const ANALOG_SYSTEMS = Object.keys(SYSTEMS).filter((k) => SYSTEMS[k].analog);                 // N64, PlayStation, PSP: real analog sticks
export const MAX_PLAYERS = Object.fromEntries(Object.entries(SYSTEMS).map(([k, s]) => [k, s.players]));

// RetroPad control indices used by EmulatorJS
export const CONTROLS = [
  { i: 8, l: 'A' }, { i: 0, l: 'B' }, { i: 9, l: 'X' }, { i: 1, l: 'Y' },
  { i: 10, l: 'L' }, { i: 11, l: 'R' }, { i: 12, l: 'L2 / ZL' }, { i: 13, l: 'R2 / ZR' },
  { i: 3, l: 'Start' }, { i: 2, l: 'Select' },
  { i: 4, l: 'D-pad Up' }, { i: 5, l: 'D-pad Down' }, { i: 6, l: 'D-pad Left' }, { i: 7, l: 'D-pad Right' },
  { i: 14, l: 'L3 (stick click)' }, { i: 15, l: 'R3 (stick click)' },
];
export const PAD_LABELS = { 0: 'BUTTON_1', 1: 'BUTTON_2', 2: 'BUTTON_3', 3: 'BUTTON_4', 4: 'LEFT_TOP_SHOULDER', 5: 'RIGHT_TOP_SHOULDER', 6: 'LEFT_BOTTOM_SHOULDER', 7: 'RIGHT_BOTTOM_SHOULDER', 8: 'SELECT', 9: 'START', 10: 'LEFT_STICK', 11: 'RIGHT_STICK', 12: 'DPAD_UP', 13: 'DPAD_DOWN', 14: 'DPAD_LEFT', 15: 'DPAD_RIGHT' };
export const PRETTY = { BUTTON_1: 'Face ↓ (A/✕)', BUTTON_2: 'Face → (B/○)', BUTTON_3: 'Face ← (X/□)', BUTTON_4: 'Face ↑ (Y/△)', LEFT_TOP_SHOULDER: 'L1 / LB', RIGHT_TOP_SHOULDER: 'R1 / RB', LEFT_BOTTOM_SHOULDER: 'L2 / LT', RIGHT_BOTTOM_SHOULDER: 'R2 / RT', SELECT: 'Select / Back', START: 'Start', LEFT_STICK: 'L3', RIGHT_STICK: 'R3', DPAD_UP: 'D-pad ↑', DPAD_DOWN: 'D-pad ↓', DPAD_LEFT: 'D-pad ←', DPAD_RIGHT: 'D-pad →' };
export const prettyPad = (l) => (l ? PRETTY[l] || l.replace(/_/g, ' ').replace(':+1', ' +').replace(':-1', ' −') : '—');

// Gamepad "pad" bindings per layout. nintendo = physical position (right button = A, bottom = B); xbox = labels (A = A).
const SHARED = { 2: 'SELECT', 3: 'START', 4: 'DPAD_UP', 5: 'DPAD_DOWN', 6: 'DPAD_LEFT', 7: 'DPAD_RIGHT', 10: 'LEFT_TOP_SHOULDER', 11: 'RIGHT_TOP_SHOULDER', 12: 'LEFT_BOTTOM_SHOULDER', 13: 'RIGHT_BOTTOM_SHOULDER', 14: 'LEFT_STICK', 15: 'RIGHT_STICK', 16: 'LEFT_STICK_X:+1', 17: 'LEFT_STICK_X:-1', 18: 'LEFT_STICK_Y:+1', 19: 'LEFT_STICK_Y:-1', 20: 'RIGHT_STICK_X:+1', 21: 'RIGHT_STICK_X:-1', 22: 'RIGHT_STICK_Y:+1', 23: 'RIGHT_STICK_Y:-1' };
export const PAD_DEFAULTS = {
  nintendo: { ...SHARED, 0: 'BUTTON_1', 8: 'BUTTON_2', 1: 'BUTTON_3', 9: 'BUTTON_4' },
  xbox: { ...SHARED, 0: 'BUTTON_2', 8: 'BUTTON_1', 1: 'BUTTON_4', 9: 'BUTTON_3' },
};
// Desktop keyboard defaults (player 1 only)
export const KB_DEFAULTS = {
  retro: { 8: 'x', 0: 'z', 9: 's', 1: 'a', 10: 'q', 11: 'w', 12: 'e', 13: 'r', 2: 'backspace', 3: 'enter', 4: 'up arrow', 5: 'down arrow', 6: 'left arrow', 7: 'right arrow', 24: 'f5', 25: 'f9' },
  ejs: { 0: 'x', 1: 's', 2: 'v', 3: 'enter', 4: 'up arrow', 5: 'down arrow', 6: 'left arrow', 7: 'right arrow', 8: 'z', 9: 'a', 10: 'q', 11: 'e', 12: 'tab', 13: 'r', 24: '1', 25: '2' },
};

export const DEFAULT_PAD = { layout: 'nintendo', deadzone: 0.15, hideTouch: true, hotkeys: true, keyboard: true, kbPreset: 'retro', stickAsDpad: true, map: {}, assign: {} };
export const loadPad = () => { try { return { ...DEFAULT_PAD, ...JSON.parse(localStorage.getItem('rp.pad') || '{}') }; } catch { return { ...DEFAULT_PAD }; } };
export const savePad = (s) => localStorage.setItem('rp.pad', JSON.stringify(s));

/** EmulatorJS `controls` object ({player:{controlIndex:{value:key, value2:gamepadLabel}}}) for 4 players, user overrides applied. */
export function buildControls(s = loadPad()) {
  const out = { 0: {}, 1: {}, 2: {}, 3: {} };
  const pad = PAD_DEFAULTS[s.layout] || PAD_DEFAULTS.nintendo, kb = KB_DEFAULTS[s.kbPreset] || KB_DEFAULTS.retro;
  for (let p = 0; p < 4; p++) {
    for (let i = 0; i < 26; i++) {
      const e = {};
      if (p === 0 && s.keyboard && kb[i]) e.value = kb[i];
      if (pad[i]) e.value2 = pad[i];
      const o = (s.map && s.map[p] && s.map[p][i]) || null;
      if (o) { if ('pad' in o) { if (o.pad) e.value2 = o.pad; else delete e.value2; } if ('key' in o) { if (o.key) e.value = o.key; else delete e.value; } }
      if (Object.keys(e).length) out[p][i] = e;
    }
  }
  return out;
}

/* ---------- raw access + shim ---------- */
const origGet = (typeof navigator !== 'undefined' && navigator.getGamepads) ? navigator.getGamepads.bind(navigator) : () => [];
export const rawPads = () => Array.from((window.__rpRawGamepads || origGet)() || []).filter((g) => g && g.connected !== false);
export const padKey = (g) => g.id;

const HAT = [[-1, 'u'], [-0.7142857, 'ur'], [-0.4285714, 'r'], [-0.1428571, 'dr'], [0.1428571, 'd'], [0.4285714, 'dl'], [0.7142857, 'l'], [1, 'ul']];
function hatDirs(v) { if (v > 1.1 || v < -1.1) return ''; let best = '', d = 9; for (const [x, n] of HAT) { const dd = Math.abs(x - v); if (dd < d) { d = dd; best = n; } } return d < 0.1 ? best : ''; }

export function transform(g, s, system) {
  const dz = Math.min(0.6, Math.max(0, s.deadzone));
  const buttons = [];
  const nb = Math.max(g.buttons.length, 17);
  for (let i = 0; i < nb; i++) {
    const b = g.buttons[i]; const v = b ? (typeof b === 'object' ? b.value : b) : 0;
    const pressed = b ? (typeof b === 'object' ? b.pressed || v > ((i === 6 || i === 7) ? 0.4 : 0.5) : b > 0.5) : false;   // analog triggers -> digital
    buttons.push({ pressed, touched: pressed, value: pressed ? Math.max(v, 1) : v });
  }
  const axes = Array.from(g.axes);
  for (let a = 0; a + 1 < Math.min(axes.length, 4); a += 2) {            // radial deadzone per stick
    const x = axes[a], y = axes[a + 1], m = Math.hypot(x, y);
    if (m < dz) { axes[a] = 0; axes[a + 1] = 0; } else { const k = ((m - dz) / (1 - dz)) / m; axes[a] = x * k; axes[a + 1] = y * k; }
  }
  for (let a = 4; a < axes.length; a++) if (Math.abs(axes[a]) < dz && g.mapping === 'standard') axes[a] = 0;
  const press = (i) => { buttons[i] = { pressed: true, touched: true, value: 1 }; };
  if (g.mapping !== 'standard' && axes.length >= 10 && (axes[9] > 1.1 || axes[9] < -1.1 || Math.abs(axes[9]) <= 1)) {   // hat switch exposed as an axis (Switch Pro/8BitDo on some platforms)
    const h = hatDirs(axes[9]); if (h.includes('u')) press(12); if (h.includes('d')) press(13); if (h.includes('l')) press(14); if (h.includes('r')) press(15); axes[9] = 0;
  }
  if (s.stickAsDpad && !ANALOG_SYSTEMS.includes(system)) {              // digital systems: left stick behaves like the D-pad
    const x = axes[0] || 0, y = axes[1] || 0, th = Math.max(0.5, dz + 0.1);
    if (y < -th) press(12); if (y > th) press(13); if (x < -th) press(14); if (x > th) press(15);
    axes[0] = 0; axes[1] = 0;
  }
  if (s.hotkeys && buttons[8] && buttons[8].pressed) { for (const i of [3, 4, 5, 16]) if (buttons[i]) buttons[i] = { pressed: false, touched: false, value: 0 }; }   // Select+X combos belong to the app
  return { id: g.id, index: g.index, connected: true, mapping: g.mapping, timestamp: g.timestamp, axes, buttons, vibrationActuator: g.vibrationActuator };
}

export function installShim(getSettings, getSystem) {
  if (window.__rpShim || !navigator.getGamepads) return;
  window.__rpShim = true; window.__rpRawGamepads = navigator.getGamepads.bind(navigator);
  navigator.getGamepads = function () {
    const s = getSettings(), sys = getSystem();
    return Array.from(window.__rpRawGamepads() || []).map((g) => (g ? transform(g, s, sys) : g));
  };
}

/** Friendly name from a Gamepad id string. */
export function padName(id) {
  const m = /^(.*?)\s*\((?:STANDARD GAMEPAD )?(?:Vendor: ([0-9a-f]{4}) Product: ([0-9a-f]{4}))?/i.exec(id);
  let n = (m && m[1]) || id;
  if (/054c/i.test(id) || /dualsense|dualshock|wireless controller/i.test(n)) n = /0ce6|dualsense/i.test(id) ? 'DualSense' : 'DualShock / PlayStation';
  else if (/045e|xbox/i.test(id)) n = 'Xbox controller';
  else if (/057e|pro controller|switch/i.test(id)) n = 'Switch controller';
  else if (/2dc8|8bitdo/i.test(id)) n = '8BitDo controller';
  return n.slice(0, 40);
}

/** Resolve which pad is which player: explicit assignment first, then connection order. Returns [padOrNull x 4]. */
export function assignPlayers(pads, s = loadPad()) {
  const slots = [null, null, null, null], rest = [];
  const off = new Set();
  for (const g of pads) {
    const a = s.assign && s.assign[padKey(g)];
    if (a === -1) off.add(g.index); else if (typeof a === 'number' && a >= 0 && a < 4 && !slots[a]) slots[a] = g; else rest.push(g);
  }
  for (const g of rest) { const f = slots.indexOf(null); if (f >= 0) slots[f] = g; }
  return slots;
}

/** Wait for the next pad button/axis input; resolves a label like BUTTON_1 / LEFT_STICK_X:+1. */
export function captureNextInput(signal) {
  return new Promise((resolve) => {
    const base = new Map(); let raf;
    const tick = () => {
      if (signal && signal.aborted) return resolve(null);
      for (const g of rawPads()) {
        const b0 = base.get(g.index) || { b: g.buttons.map((b) => (b.pressed ? 1 : 0)), a: g.axes.slice() }; base.set(g.index, b0);
        for (let i = 0; i < g.buttons.length; i++) if (g.buttons[i].pressed && !b0.b[i]) return resolve(PAD_LABELS[i] || `GAMEPAD_${i}`);
        for (let a = 0; a < Math.min(g.axes.length, 4); a++) if (Math.abs(g.axes[a]) > 0.7 && Math.abs(b0.a[a]) < 0.4) return resolve(`${['LEFT_STICK_X', 'LEFT_STICK_Y', 'RIGHT_STICK_X', 'RIGHT_STICK_Y'][a]}:${g.axes[a] > 0 ? '+1' : '-1'}`);
      }
      raf = setTimeout(tick, 30);
    };
    tick(); if (signal) signal.addEventListener('abort', () => { clearTimeout(raf); resolve(null); });
  });
}

const KEYCODE_NAMES = { 8: 'backspace', 9: 'tab', 13: 'enter', 16: 'shift', 17: 'ctrl', 18: 'alt', 32: 'space', 37: 'left arrow', 38: 'up arrow', 39: 'right arrow', 40: 'down arrow', 188: 'comma', 190: 'period', 191: 'forward slash', 186: 'semi-colon', 222: 'single quote', 219: 'open bracket', 221: 'close braket', 220: 'back slash', 189: 'dash', 187: 'equal sign' };
for (let k = 112; k <= 123; k++) KEYCODE_NAMES[k] = 'f' + (k - 111);
export function keyName(e) {
  const k = e.keyCode; if (KEYCODE_NAMES[k]) return KEYCODE_NAMES[k];
  if (k >= 65 && k <= 90) return String.fromCharCode(k).toLowerCase();
  if (k >= 48 && k <= 57) return String(k - 48);
  return null;
}

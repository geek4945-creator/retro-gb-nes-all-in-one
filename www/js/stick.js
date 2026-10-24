// Analog stick direction safety net (N64 / PlayStation / PSP / any core that reads the RetroPad analog axes).
//
//  • EmulatorJS control indices: 16 = left stick X+ (right), 17 = X− (left), 18 = Y+ (down), 19 = Y− (up);
//    20–23 = the same for the right stick (N64 C-buttons). Every input source — keyboard, Bluetooth / USB gamepad and
//    the on-screen stick — ends up in gameManager.simulateInput(player, index, value) with a positive magnitude, so
//    swapping 16↔17 / 18↔19 there flips an axis for all three at once without touching anyone's custom button map.
//  • "Invert left stick X / Y" is a per-system setting (Settings → Controllers), off by default.
//  • The on-screen stick had a dead spot: nipplejs reports exactly 0° when pushed straight right and EmulatorJS 4.2.3
//    only handles 0° < angle ≤ 359.9°, so "full right" sent nothing. patchNipple() nudges the angle into range.
import { loadPad, savePad } from './pads.js';

const SWAP_X = { 16: 17, 17: 16 }, SWAP_Y = { 18: 19, 19: 18 };
export const loadInvert = (sys, s = loadPad()) => { const v = (s.invert || {})[sys] || {}; return { x: !!v.x, y: !!v.y }; };
export function saveInvert(sys, inv) { const s = loadPad(); s.invert = { ...(s.invert || {}), [sys]: { x: !!inv.x, y: !!inv.y } }; savePad(s); }

/** Control index after applying the per-system inversion. */
export function mapStick(index, inv) {
  if (inv && inv.x && index in SWAP_X) return SWAP_X[index];
  if (inv && inv.y && index in SWAP_Y) return SWAP_Y[index];
  return index;
}

/** Wrap EmulatorJS' local input entry point (keyboard + gamepad + touch). Netplay remote inputs are not touched. */
export function wrapSimulateInput(gm, getInv) {
  if (!gm || gm.__rpStick || typeof gm.simulateInput !== 'function') return false;
  const orig = gm.simulateInput.bind(gm);
  gm.simulateInput = (player, index, value) => orig(player, mapStick(index, getInv()), value);
  gm.__rpStick = true;
  return true;
}

/** nipplejs angle fix; must run before EmulatorJS' loader defines window.nipplejs. */
export function fixAngle(info) {
  const a = info && info.angle; if (!a || typeof a.degree !== 'number') return info;
  if (a.degree <= 0 || a.degree > 359.9) return { ...info, angle: { ...a, degree: 0.001 } };   // straight right
  return info;
}
export function patchNipple(w = window) {
  if (w.__rpNipple) return; w.__rpNipple = true;
  let lib;
  const wrap = (L) => {
    if (!L || typeof L.create !== 'function' || L.__rpWrapped) return L;
    const create = L.create.bind(L);
    L.create = (opts) => {
      const col = create(opts);
      if (col && typeof col.on === 'function') {
        const on = col.on.bind(col);
        col.on = (types, cb) => on(types, /\bmove\b/.test(types) && typeof cb === 'function' ? (evt, info) => cb(evt, fixAngle(info)) : cb);
      }
      return col;
    };
    L.__rpWrapped = true;
    return L;
  };
  try {
    Object.defineProperty(w, 'nipplejs', { configurable: true, enumerable: true, get: () => lib, set: (v) => { lib = wrap(v); } });
  } catch {}
}

// The ONE path from a physical controller (Bluetooth / USB, Gamepad API) to the emulator core.
//
// EmulatorJS 4.2.3 polls navigator.getGamepads() (our shim in pads.js adds deadzone / hat / hotkey handling) and its
// gamepadEvent() turns changes into gameManager.simulateInput(). For analog sticks it has a bug: for control indices
// 16–23 it only looks at the AXIS NAME of a binding and ignores its direction, so "positive axis value" is always sent
// to the even index (16 = right / 18 = down) no matter whether you bound STICK RIGHT to LEFT_STICK_X:+1 or :-1. A
// controller whose X axis is reported the other way round therefore could not be fixed by remapping.
// deliverPadEvent() replaces that part: every binding is honoured with its direction (+1 / −1), analog bindings send a
// proportional 0..0x7fff value to their own index, digital bindings fire past half travel. Everything still goes through
// gameManager.simulateInput, so the per-system "Invert ←→ / ↑↓" option (stick.js) applies to controllers as well.
// While EmulatorJS' own "Control Settings" popup is waiting for a button, its original handler is used (capture).
import { isAnalogIndex } from './pads.js';

/** Parse a binding label: "LEFT_STICK_X:-1" -> { axis: 'LEFT_STICK_X', dir: -1 }; button labels -> null. */
export function axisBinding(label) {
  if (typeof label !== 'string') return null;
  const m = /^([A-Z_]+?_STICK_[XY]|EXTRA_STICK_\d+)(?::([+-]1))?$/.exec(label);
  return m ? { axis: m[1], dir: m[2] === '-1' ? -1 : 1 } : null;
}

/** Inputs for one gamepad event: [[controlIndex, value], ...] using the player's controls. */
export function inputsFor(controls, e) {
  const out = [];
  for (let j = 0; j < 30; j++) {
    const c = controls && controls[j]; if (!c || c.value2 === undefined || c.value2 === '') continue;
    const b = c.value2;
    if (e.type === 'buttondown' || e.type === 'buttonup') {
      if (b === e.label || b === e.index) out.push([j, e.type === 'buttonup' ? 0 : (isAnalogIndex(j) ? 0x7fff : 1)]);
    } else if (e.type === 'axischanged') {
      const a = axisBinding(b); if (!a || a.axis !== e.axis) continue;
      const mag = Math.max(0, Math.min(1, a.dir * (e.value || 0)));
      out.push([j, isAnalogIndex(j) ? Math.round(0x7fff * mag) : (mag > 0.5 ? 1 : 0)]);
    }
  }
  return out;
}

export function deliverPadEvent(emu, e, orig) {
  if (!emu.started) return;
  const gp = emu.gamepad.gamepads[e.gamepadIndex]; if (!gp) return;
  const player = emu.gamepadSelection.indexOf(gp.id + '_' + gp.index);
  if (player < 0) return;
  const capturing = emu.controlPopup && emu.controlPopup.parentElement && emu.controlPopup.parentElement.parentElement.getAttribute('hidden') === null;
  if (capturing) return orig && orig(e);
  if ((emu.settingsMenu && emu.settingsMenu.style.display !== 'none') || (emu.isPopupOpen && emu.isPopupOpen())) return;
  const last = (emu.__rpPadLast = emu.__rpPadLast || {});
  for (const [j, v] of inputsFor(emu.controls[player], e)) {
    const k = player + ':' + j;
    if (last[k] === v && e.type === 'axischanged') continue;     // don't flood the core with repeats
    last[k] = v;
    emu.gameManager.simulateInput(player, j, v);
  }
}

/** Route EmulatorJS' gamepad events through deliverPadEvent (idempotent). */
export function takeOverGamepad(emu) {
  if (!emu || !emu.gamepad || emu.__rpPadTaken) return false;
  const orig = emu.gamepadEvent.bind(emu);
  const h = (e) => deliverPadEvent(emu, e, orig);
  for (const t of ['axischanged', 'buttondown', 'buttonup']) emu.gamepad.on(t, h);
  emu.__rpPadTaken = true;
  return true;
}

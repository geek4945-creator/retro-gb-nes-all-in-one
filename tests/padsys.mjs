// Per-system controller wiring (pure Node): player counts, analog systems, stick->D-pad only on digital systems.
import { transform, ANALOG_SYSTEMS, MAX_PLAYERS, DEFAULT_PAD } from '../www/js/pads.js';
import { SYSTEMS } from '../www/js/cores.js';
let bad = 0; const ok = (c, m) => { if (!c) { bad++; console.log('FAIL', m); } else console.log('PASS', m); };
ok(JSON.stringify(ANALOG_SYSTEMS.sort()) === JSON.stringify(['n64', 'psp', 'psx']), 'analog systems: ' + ANALOG_SYSTEMS);
ok(MAX_PLAYERS.n64 === 4 && MAX_PLAYERS.arcade === 4 && MAX_PLAYERS.nes === 2 && MAX_PLAYERS.gba === 1 && MAX_PLAYERS.psx === 2 && MAX_PLAYERS.md === 2, 'player counts');
ok(Object.keys(SYSTEMS).every((k) => MAX_PLAYERS[k] >= 1 && MAX_PLAYERS[k] <= 4), 'every system has 1-4 players');
const pad = (axes) => ({ id: 'Xbox (STANDARD GAMEPAD)', index: 0, connected: true, mapping: 'standard', timestamp: 0, axes, buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) });
const s = { ...DEFAULT_PAD, stickAsDpad: true };
for (const k of Object.keys(SYSTEMS)) {
  const t = transform(pad([0.9, 0, 0, 0]), s, k);
  const analog = SYSTEMS[k].analog;
  ok(analog ? (t.axes[0] > 0.8 && !t.buttons[15].pressed) : (t.axes[0] === 0 && t.buttons[15].pressed), `${k}: left stick ${analog ? 'stays analog' : 'acts as D-pad right'}`);
}
const t = transform(pad([0, 0, 0.9, 0]), s, 'n64'); ok(t.axes[2] > 0.8, 'n64: right stick (C buttons) passes through');
console.log(bad ? `${bad} FAILED` : 'pad/system tests passed'); process.exit(bad ? 1 : 0);

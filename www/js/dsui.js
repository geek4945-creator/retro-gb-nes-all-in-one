// Settings -> Nintendo DS touch & screens: touch mode, screen layout, trackpad speed (stored in localStorage "rp.ds", used by dstouch.js).
import { loadDs, saveDs, LAYOUT_ORDER, LAYOUT_LABELS, MODE_LABELS, SPEEDS } from './dstouch.js';

const el = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); for (const k of kids) e.append(k); return e; };

export function openDsTouch(dlg) {
  const s = loadDs();
  const row = (label, id, opts, value, onchange, note) => el('label', { className: 'row ds-row' }, el('span', { textContent: label }),
    el('select', { id, onchange: (e) => onchange(e.target.value) }, ...opts.map(([v, t]) => el('option', { value: v, textContent: t, selected: String(value) === String(v) }))), note || '');
  const set = (k) => (v) => { const cur = loadDs(); cur[k] = k === 'speed' ? Number(v) : v; saveDs(cur); };
  dlg.replaceChildren(
    el('h3', { textContent: 'Nintendo DS touch & screens' }),
    el('p', { className: 'muted small', textContent: 'The bottom screen is the touchscreen. Touches that start on the top screen are ignored, a second finger can hold a button while the first uses the stylus, and dragging past the edge keeps the stylus at the edge. Applies to DeSmuME 2015 and melonDS.' }),
    row('Touch mode', 'ds-mode', Object.entries(MODE_LABELS), s.mode, set('mode')),
    el('p', { className: 'muted small', textContent: 'Direct: the stylus is where your finger is. Trackpad: drag anywhere below/around the bottom screen to move a cursor, tap to tap, tap then drag (or hold a 2nd finger) to hold the stylus down.' }),
    row('Screen layout', 'ds-layout', LAYOUT_ORDER.map((k) => [k, LAYOUT_LABELS[k]]), s.layout, set('layout')),
    row('Trackpad speed', 'ds-speed', SPEEDS.map((v) => [v, `${v}×`]), s.speed, set('speed')),
    el('p', { className: 'muted small', textContent: 'On a computer the mouse works directly on the bottom screen (click and drag). You can also switch these in the in-game ☰ menu.' }),
    el('button', { className: 'row ghost', textContent: 'Back', onclick: () => { dlg.close(); document.getElementById('btn-settings').click(); } }));
  if (!dlg.open) dlg.showModal();
}

// In-game menu button: where it sits (top-left / top-center / top-right) and whether it fades out when idle.
// Stored in localStorage "rp.ui"; read by player.js and edited in Library -> Settings -> "In-game menu button…".
export const UI_POS = { left: 'Top-left', center: 'Top-center', right: 'Top-right' };
export const UI_DEFAULTS = { pos: 'right', autohide: true };
const KEY = 'rp.ui';

export function loadUi() {
  try { const o = JSON.parse(localStorage.getItem(KEY) || '{}'); return { pos: UI_POS[o.pos] ? o.pos : UI_DEFAULTS.pos, autohide: typeof o.autohide === 'boolean' ? o.autohide : UI_DEFAULTS.autohide }; }
  catch { return { ...UI_DEFAULTS }; }
}
export function saveUi(s) {
  const v = { pos: UI_POS[s.pos] ? s.pos : UI_DEFAULTS.pos, autohide: !!s.autohide };
  try { localStorage.setItem(KEY, JSON.stringify(v)); } catch {}
  try { dispatchEvent(new CustomEvent('rp-ui-change', { detail: v })); } catch {}
  return v;
}

const el = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); for (const k of kids) e.append(k); return e; };
export function openMenuBtnSettings(dlg) {
  const s = loadUi();
  dlg.replaceChildren(
    el('h3', { textContent: 'In-game menu button' }),
    el('p', { className: 'muted small', textContent: 'While you play, the only on-screen control besides the game pad is one small ☰ button at the top. It opens Resume, Save/Load state, Restart, Sound, Fast-forward, Screenshot, Fullscreen, Controls, Cheats, Settings and Exit. Touching empty areas of the screen does nothing.' }),
    el('label', { className: 'row ds-row' }, el('span', { textContent: 'Button position' }),
      el('select', { id: 'ui-pos', onchange: (e) => saveUi({ ...loadUi(), pos: e.target.value }) },
        ...Object.entries(UI_POS).map(([v, t]) => el('option', { value: v, textContent: t, selected: s.pos === v })))),
    el('label', { className: 'row ds-row' }, el('span', { textContent: 'Fade out when idle' }),
      el('input', { type: 'checkbox', id: 'ui-autohide', checked: s.autohide, onchange: (e) => saveUi({ ...loadUi(), autohide: e.target.checked }) })),
    el('p', { className: 'muted small', textContent: 'Faded out, the button is still there and still works with one tap; touching near the top edge brings it back. You can also move it from the in-game menu, and on a controller use Select + Start (hold).' }),
    el('button', { className: 'row ghost', textContent: 'Back', onclick: () => { dlg.close(); document.getElementById('btn-settings').click(); } }));
  if (!dlg.open) dlg.showModal();
}

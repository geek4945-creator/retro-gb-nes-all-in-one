// Settings > Controllers: connected pads, player assignment, options (deadzone, layout, ...) and per-player button remapping.
import { CONTROLS, PAD_DEFAULTS, KB_DEFAULTS, loadPad, savePad, rawPads, padName, padKey, prettyPad, captureNextInput, keyName, PAD_LABELS, PRETTY, assignPlayers, ANALOG_SYSTEMS } from './pads.js';
import { SYSTEMS } from './cores.js';

const $ = (s, r = document) => r.querySelector(s);
const el = (tag, props = {}, ...kids) => {
  const { dataset, ...rest } = props; const e = Object.assign(document.createElement(tag), rest);
  if (dataset) Object.assign(e.dataset, dataset);
  for (const k of kids) e.append(k); return e;
};

export function openControllers() {
  const dlg = $('#pads'); dlg.replaceChildren();
  let cfg = loadPad(), player = 0, timer = 0, capAbort = null;
  const save = () => savePad(cfg);
  const close = el('button', { className: 'btn ghost', type: 'button', textContent: 'Close', onclick: () => dlg.close() });
  dlg.onclose = () => { clearInterval(timer); if (capAbort) capAbort.abort(); window.__rpCapturing = false; };

  /* connected list */
  const list = el('div', { id: 'pad-list', className: 'pad-list' });
  const sigOf = () => rawPads().map((g) => g.id + g.index).join('|') + JSON.stringify(cfg.assign);
  let lastSig = null;
  function paintList() {
    const pads = rawPads();
    const sig = sigOf();
    if (sig !== lastSig) {
      lastSig = sig; list.replaceChildren();
      if (!pads.length) list.append(el('p', { className: 'muted', textContent: 'No controller detected. Connect one (Bluetooth or USB) and press any button — browsers only reveal a controller after its first button press. Xbox, PlayStation (DualShock 4/DualSense), Switch Pro, 8BitDo and generic pads work.' }));
      const slots = assignPlayers(pads, cfg);
      for (const g of pads) {
        const cur = cfg.assign[padKey(g)];
        const auto = slots.indexOf(g);
        const sel = el('select', { onchange: (e) => { const v = e.target.value; if (v === 'auto') delete cfg.assign[padKey(g)]; else cfg.assign[padKey(g)] = Number(v); save(); lastSig = null; } },
          el('option', { value: 'auto', textContent: `Auto (${auto >= 0 ? 'Player ' + (auto + 1) : 'unassigned'})`, selected: cur === undefined }),
          ...[0, 1, 2, 3].map((p) => el('option', { value: p, textContent: `Player ${p + 1}`, selected: cur === p })),
          el('option', { value: -1, textContent: 'Off', selected: cur === -1 }));
        list.append(el('div', { className: 'pad-item', dataset: { index: g.index } },
          el('div', { className: 'pad-name', textContent: `${padName(g.id)} (slot ${g.index})` }),
          el('div', { className: 'muted small', textContent: `${g.id} · ${g.mapping || 'non-standard'} mapping · ${g.buttons.length} buttons · ${g.axes.length} axes` }),
          el('label', { className: 'row select' }, 'Player', sel),
          el('div', { className: 'pad-live muted small', textContent: '—' })));
      }
    }
    for (const g of pads) {
      const live = $(`.pad-item[data-index="${g.index}"] .pad-live`, list); if (!live) continue;
      const pressed = g.buttons.map((b, i) => (b.pressed ? prettyPad(PAD_LABELS[i] || 'GAMEPAD_' + i) : null)).filter(Boolean);
      live.textContent = `Pressed: ${pressed.join(', ') || 'nothing'} · L stick ${(g.axes[0] || 0).toFixed(2)}, ${(g.axes[1] || 0).toFixed(2)} · R stick ${(g.axes[2] || 0).toFixed(2)}, ${(g.axes[3] || 0).toFixed(2)}`;
    }
  }

  /* options */
  const chk = (label, key, id) => el('label', { className: 'row select' }, label, el('input', { type: 'checkbox', id, checked: !!cfg[key], onchange: (e) => { cfg[key] = e.target.checked; save(); if (key === 'keyboard') paintMap(); } }));
  const dzVal = el('span', { className: 'muted', textContent: cfg.deadzone.toFixed(2) });
  const dz = el('input', { type: 'range', id: 'pad-dz', min: 0, max: 0.5, step: 0.01, value: cfg.deadzone, oninput: (e) => { cfg.deadzone = Number(e.target.value); dzVal.textContent = cfg.deadzone.toFixed(2); save(); } });
  const layout = el('select', { id: 'pad-layout', onchange: (e) => { cfg.layout = e.target.value; save(); paintMap(); } },
    el('option', { value: 'nintendo', textContent: 'Nintendo positions (right = A, bottom = B)', selected: cfg.layout === 'nintendo' }),
    el('option', { value: 'xbox', textContent: 'Xbox labels (A = A, B = B)', selected: cfg.layout === 'xbox' }));
  const kbp = el('select', { id: 'pad-kbp', onchange: (e) => { cfg.kbPreset = e.target.value; save(); paintMap(); } },
    el('option', { value: 'retro', textContent: 'Retro Pocket (X=A, Z=B, Enter=Start, Backspace=Select)', selected: cfg.kbPreset === 'retro' }),
    el('option', { value: 'ejs', textContent: 'EmulatorJS default', selected: cfg.kbPreset === 'ejs' }));
  const opts = el('div', {},
    el('label', { className: 'row select' }, 'Button layout', layout),
    el('label', { className: 'row select' }, el('span', {}, 'Stick deadzone ', dzVal), dz),
    chk('Left stick acts as D-pad (NES/GB/GBA/SNES/DS)', 'stickAsDpad', 'pad-stick'),
    chk('Hide on-screen pad while a controller is connected', 'hideTouch', 'pad-hide'),
    chk('Hotkeys (Select+Start menu, Select+R1/L1 save/load)', 'hotkeys', 'pad-hotkeys'),
    chk('Keyboard controls (desktop)', 'keyboard', 'pad-kb'),
    el('label', { className: 'row select' }, 'Keyboard preset', kbp),
    // per-system analog stick direction fix (keyboard + controller + on-screen stick; custom button maps untouched — stick.js)
    ...ANALOG_SYSTEMS.map((sys) => {
      const inv = (cfg.invert && cfg.invert[sys]) || {};
      const box = (axis, label) => el('label', { className: 'inv-opt' }, el('input', { type: 'checkbox', id: `pad-inv-${sys}-${axis}`, checked: !!inv[axis],
        onchange: (e) => { cfg.invert = { ...(cfg.invert || {}) }; cfg.invert[sys] = { ...(cfg.invert[sys] || {}), [axis]: e.target.checked }; save(); } }), ' ' + label);
      return el('div', { className: 'row select inv-row' }, el('span', {}, `${SYSTEMS[sys].short || SYSTEMS[sys].label} left stick`), el('span', { className: 'inv-opts' }, box('x', 'Invert ←→'), box('y', 'Invert ↑↓')));
    }),
    el('p', { className: 'muted small', textContent: 'Keyboard stick: T / F / G / H = up / left / down / right, I / J / K / L = right stick (N64 C-buttons).' }));

  /* mapping table */
  const tabs = el('div', { className: 'chips', id: 'pad-tabs' });
  const table = el('div', { id: 'pad-map', className: 'pad-map' });
  function paintTabs() {
    tabs.replaceChildren(...[0, 1, 2, 3].map((p) => el('button', { type: 'button', className: 'chip' + (p === player ? ' on' : ''), textContent: `P${p + 1}`, onclick: () => { player = p; paintTabs(); paintMap(); } })));
  }
  const effective = (p, i) => {
    const pad = PAD_DEFAULTS[cfg.layout] || PAD_DEFAULTS.nintendo, kb = KB_DEFAULTS[cfg.kbPreset] || KB_DEFAULTS.retro, o = (cfg.map[p] || {})[i] || {};
    return { pad: 'pad' in o ? o.pad : pad[i], key: 'key' in o ? o.key : (p === 0 && cfg.keyboard ? kb[i] : '') };
  };
  const setOv = (p, i, patch) => { cfg.map[p] = cfg.map[p] || {}; cfg.map[p][i] = { ...(cfg.map[p][i] || {}), ...patch }; save(); paintMap(); };
  function paintMap() {
    table.replaceChildren(el('div', { className: 'map-head' }, el('span', { textContent: 'Control' }), el('span', { textContent: 'Controller' }), el('span', { textContent: player === 0 ? 'Keyboard' : '' })));
    for (const c of CONTROLS) {
      const e = effective(player, c.i);
      const padBtn = el('button', { className: 'btn map-pad', type: 'button', textContent: prettyPad(e.pad), dataset: { i: c.i } });
      padBtn.onclick = async () => {
        if (capAbort) capAbort.abort(); capAbort = new AbortController(); window.__rpCapturing = true;
        padBtn.textContent = 'Press a button…'; padBtn.classList.add('capturing');
        const t = setTimeout(() => capAbort.abort(), 8000);
        const label = await captureNextInput(capAbort.signal); clearTimeout(t); window.__rpCapturing = false;
        if (label) setOv(player, c.i, { pad: label }); else paintMap();
      };
      const row = el('div', { className: 'map-row' }, el('span', { textContent: c.l }), padBtn);
      if (player === 0) {
        const keyBtn = el('button', { className: 'btn map-key', type: 'button', textContent: e.key || '—', dataset: { i: c.i } });
        keyBtn.onclick = () => {
          keyBtn.textContent = 'Press a key…'; window.__rpCapturing = true;
          const h = (ev) => { ev.preventDefault(); ev.stopPropagation(); removeEventListener('keydown', h, true); window.__rpCapturing = false;
            if (ev.key === 'Escape') return paintMap(); const n = keyName(ev); if (n) setOv(0, c.i, { key: n }); else paintMap(); };
          addEventListener('keydown', h, true);
        };
        row.append(keyBtn);
      }
      table.append(row);
    }
    table.append(el('button', { className: 'btn ghost', type: 'button', id: 'pad-reset', textContent: `Reset Player ${player + 1} to defaults`, onclick: () => { delete cfg.map[player]; save(); paintMap(); } }));
  }

  const help = el('div', { className: 'muted small' },
    el('p', { textContent: 'In a game: hold Select + Start (or press the Guide/Home button) for the pause menu · Select + R1 quick-save · Select + L1 quick-load. Press any controller button after connecting to wake it up.' }),
    el('p', { textContent: 'In the library: D-pad / left stick moves, A opens a game, B goes back, Start opens the game options, Select opens Settings, L1/R1 switch the system filter.' }),
    el('p', { textContent: 'Mappings apply to every system. Analog stick axes (N64/PS1/PSP-style cores) are passed through with your deadzone; for NES, Game Boy, GBA, SNES and DS the left stick acts as a D-pad. Triggers are treated as digital L2/R2 buttons.' }));

  dlg.append(el('div', { className: 'cv-main' },
    el('div', { className: 'cv-head' }, el('h3', { textContent: 'Controllers' }), close),
    el('h4', { textContent: 'Connected' }), list,
    el('h4', { textContent: 'Options' }), opts,
    el('h4', { textContent: 'Button mapping' }), tabs, table, help));
  paintTabs(); paintMap(); paintList(); timer = setInterval(paintList, 150);
  dlg.showModal();
}

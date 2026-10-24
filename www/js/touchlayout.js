// Touch layout editor for EmulatorJS' on-screen gamepad: drag / resize each control, opacity, presets and skins, saved per system.
// EmulatorJS builds the pad once; we restyle its DOM (each control carries a `b_<id>` class). Buttons move/scale with a transform;
// d-pads are re-sized through their wrapper box (EmulatorJS reads the d-pad's clientWidth for hit-testing, so a scale transform
// would skew it); analog sticks (nipplejs zones) can be moved.
const KEY = 'rp.touch';
export const SKINS = { classic: 'Classic', dark: 'Dark', clear: 'Clear', retro: 'Retro colors', neon: 'Neon' };
export const PRESETS = { default: 'Default', large: 'Large', compact: 'Compact', raised: 'Raised (higher)', lefty: 'Left-handed' };
const all = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };
export const loadLayout = (sys) => ({ opacity: 1, scale: 1, skin: 'classic', lefty: false, ctrls: {}, ...(all()[sys] || {}) });
export function saveLayout(sys, l) { const a = all(); a[sys] = l; localStorage.setItem(KEY, JSON.stringify(a)); }
export function resetLayout(sys) { const a = all(); delete a[sys]; localStorage.setItem(KEY, JSON.stringify(a)); }
export function presetLayout(name, cur) {
  const base = { opacity: cur.opacity, skin: cur.skin, scale: 1, lefty: false, ctrls: {} };
  if (name === 'large') base.scale = 1.25;
  if (name === 'compact') base.scale = 0.85;
  if (name === 'raised') base.raise = 0.12;
  if (name === 'lefty') base.lefty = true;
  return base;
}

// controls currently on screen: [{id, el, kind:'button'|'dpad'|'zone'}]
export function controls(parent) {
  if (!parent) return [];
  const out = [];
  for (const el of parent.querySelectorAll('[class*="b_"]')) {
    const id = [...el.classList].find((c) => c.startsWith('b_')); if (!id || id.startsWith('b_speed')) continue;
    const kind = el.classList.contains('ejs_virtualGamepad_button') ? 'button' : el.querySelector('.ejs_dpad_main') ? 'dpad' : 'zone';
    out.push({ id: id.slice(2), el, kind });
  }
  return out;
}

export function applyLayout(emu, sys, layout = loadLayout(sys)) {
  const parent = emu && emu.virtualGamepad; if (!parent) return 0;
  try { emu.toggleVirtualGamepadLeftHanded && emu.toggleVirtualGamepadLeftHanded(!!layout.lefty); } catch {}
  parent.dataset.rpSkin = layout.skin || 'classic';
  for (const box of parent.children) box.style.opacity = String(layout.opacity ?? 1);
  const W = innerWidth, H = innerHeight, raise = (layout.raise || 0) * H;
  let n = 0;
  for (const c of controls(parent)) {
    const p = layout.ctrls[c.id] || {}, s = (p.s || 1) * (layout.scale || 1), dx = (p.x || 0) * W, dy = (p.y || 0) * H - raise;
    if (c.kind === 'dpad') {
      const size = (c.el.parentElement.clientWidth || 125) * s, off = ((c.el.parentElement.clientWidth || 125) - size) / 2;
      Object.assign(c.el.style, { position: 'absolute', left: `${off + dx}px`, top: `${off + dy}px`, width: `${size}px`, height: `${size}px`, right: 'auto' });
    } else if (c.kind === 'zone') c.el.style.transform = dx || dy ? `translate(${dx}px, ${dy}px)` : '';
    else c.el.style.transform = dx || dy || s !== 1 ? `translate(${dx}px, ${dy}px) scale(${s})` : '';
    n++;
  }
  try { dispatchEvent(new Event('resize')); } catch {}        // nipplejs re-measures its zones
  return n;
}

// full-screen editor on top of the running game. Returns a promise that resolves when the user taps Done.
export function editLayout(emu, sys, sysLabel) {
  return new Promise((resolve) => {
    let layout = loadLayout(sys), sel = null, drag = null;
    const parent = emu.virtualGamepad, wasHidden = parent.style.display === 'none';
    parent.style.display = ''; parent.style.opacity = '1'; parent.classList.add('tl-editing');
    const ov = document.createElement('div'); ov.id = 'tl-editor';
    ov.innerHTML = `<div id="tl-bar"><div class="tl-row tl-top"><button id="tl-move" type="button" title="Shrink this panel to see the controls under it">▴ Hide</button><button id="tl-reset" type="button">Reset</button><button id="tl-done" type="button" class="primary">Done</button></div>
      <div class="tl-more"><b>Touch layout · ${sysLabel}</b><span id="tl-sel">Drag a control to move it. Tap one to resize it.</span>
      <label>Size <input id="tl-size" type="range" min="50" max="200" step="5" value="100" disabled><output id="tl-size-v">–</output></label>
      <label>All controls <input id="tl-scale" type="range" min="60" max="160" step="5"><output id="tl-scale-v"></output></label>
      <label>Opacity <input id="tl-opacity" type="range" min="10" max="100" step="5"><output id="tl-opacity-v"></output></label>
      <div class="tl-row"><select id="tl-preset"><option value="">Preset…</option>${Object.entries(PRESETS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
      <select id="tl-skin">${Object.entries(SKINS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
      </div></div><div id="tl-hit"></div>`;
    document.body.append(ov);
    const $ = (s) => ov.querySelector(s);
    const outline = () => { for (const c of controls(parent)) c.el.classList.toggle('tl-selected', !!sel && c.id === sel); };
    const sync = () => {
      $('#tl-scale').value = Math.round((layout.scale || 1) * 100); $('#tl-scale-v').textContent = $('#tl-scale').value + '%';
      $('#tl-opacity').value = Math.round((layout.opacity ?? 1) * 100); $('#tl-opacity-v').textContent = $('#tl-opacity').value + '%';
      $('#tl-skin').value = layout.skin || 'classic';
      const p = sel && (layout.ctrls[sel] || {}); $('#tl-size').disabled = !sel; $('#tl-size').value = sel ? Math.round((p.s || 1) * 100) : 100; $('#tl-size-v').textContent = sel ? $('#tl-size').value + '%' : '–';
      $('#tl-sel').textContent = sel ? `Selected: ${sel.toUpperCase()}` : 'Drag a control to move it. Tap one to resize it.';
      applyLayout(emu, sys, layout); outline();
    };
    const save = () => { saveLayout(sys, layout); sync(); };
    const ctrl = (id) => (layout.ctrls[id] = layout.ctrls[id] || {});
    $('#tl-size').oninput = (e) => { if (sel) { ctrl(sel).s = e.target.value / 100; save(); } };
    $('#tl-scale').oninput = (e) => { layout.scale = e.target.value / 100; save(); };
    $('#tl-opacity').oninput = (e) => { layout.opacity = e.target.value / 100; save(); };
    $('#tl-skin').onchange = (e) => { layout.skin = e.target.value; save(); };
    $('#tl-preset').onchange = (e) => { if (!e.target.value) return; layout = presetLayout(e.target.value, layout); e.target.value = ''; sel = null; save(); };
    // Done / Reset stay at the TOP (inside the safe area) — the panel collapses instead of moving to the bottom,
    // where Android navigation buttons and the iPhone home indicator would cover it.
    $('#tl-move').onclick = () => { const m = $('#tl-bar').classList.toggle('tl-min'); $('#tl-move').textContent = m ? '▾ Show' : '▴ Hide'; };
    $('#tl-reset').onclick = () => { resetLayout(sys); layout = loadLayout(sys); sel = null; sync(); };
    $('#tl-done').onclick = () => { saveLayout(sys, layout); for (const c of controls(parent)) c.el.classList.remove('tl-selected'); ov.remove(); parent.classList.remove('tl-editing'); if (wasHidden) parent.style.display = 'none'; resolve(layout); };
    const hit = $('#tl-hit');
    const find = (x, y) => {
      let best = null, area = Infinity;
      for (const c of controls(parent)) { const r = (c.kind === 'dpad' ? c.el.firstElementChild || c.el : c.el).getBoundingClientRect(); const pad = 12;
        if (x >= r.left - pad && x <= r.right + pad && y >= r.top - pad && y <= r.bottom + pad && r.width * r.height < area) { best = c; area = r.width * r.height; } }
      return best;
    };
    hit.addEventListener('pointerdown', (e) => {
      const c = find(e.clientX, e.clientY); if (!c) { sel = null; sync(); return; }
      e.preventDefault(); hit.setPointerCapture(e.pointerId); sel = c.id;
      const p = ctrl(c.id); drag = { x0: e.clientX, y0: e.clientY, px: p.x || 0, py: p.y || 0, moved: false }; sync();
    });
    hit.addEventListener('pointermove', (e) => {
      if (!drag) return; const p = ctrl(sel), dx = e.clientX - drag.x0, dy = e.clientY - drag.y0;
      if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
      p.x = drag.px + dx / innerWidth; p.y = drag.py + dy / innerHeight; applyLayout(emu, sys, layout);
    });
    const end = () => { if (drag) { drag = null; save(); } };
    hit.addEventListener('pointerup', end); hit.addEventListener('pointercancel', end);
    sync();
  });
}

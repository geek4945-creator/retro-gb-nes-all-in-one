// Controller navigation for menus: D-pad / left stick moves focus, confirm/back buttons, shoulder buttons, Start/Select callbacks.
import { rawPads, loadPad } from './pads.js';

export function startPadNav({ getFocusables, onBack, onStart, onSelect, onL, onR, onFirstInput, enabled = () => true }) {
  let raf = 0, prev = new Map(), repeat = { dir: '', at: 0, n: 0 }, lastActive = 0;
  const confirmIdx = () => (loadPad().layout === 'xbox' ? 0 : 1), backIdx = () => (loadPad().layout === 'xbox' ? 1 : 0);

  function focusIn(dir) {
    const list = getFocusables().filter((e) => e.offsetParent !== null || e === document.activeElement);
    if (!list.length) return;
    let cur = list.includes(document.activeElement) ? document.activeElement : null;
    if (!cur) { setFocus(list[0]); return; }
    const c = rect(cur); let best = null, bs = Infinity;
    for (const e of list) {
      if (e === cur) continue; const r = rect(e);
      const dx = r.x - c.x, dy = r.y - c.y;
      const ok = dir === 'left' ? dx < -2 : dir === 'right' ? dx > 2 : dir === 'up' ? dy < -2 : dy > 2;
      if (!ok) continue;
      const prim = dir === 'left' || dir === 'right' ? Math.abs(dx) : Math.abs(dy), sec = dir === 'left' || dir === 'right' ? Math.abs(dy) : Math.abs(dx);
      const sc = prim + sec * 2.5; if (sc < bs) { bs = sc; best = e; }
    }
    if (best) setFocus(best);
  }
  const rect = (e) => { const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
  function setFocus(e) {
    document.querySelectorAll('.pad-focus').forEach((x) => x.classList.remove('pad-focus'));
    e.classList.add('pad-focus'); e.focus({ preventScroll: true }); e.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  const confirm = () => {
    const e = document.activeElement; if (!e || e === document.body || !e.classList.contains('pad-focus')) { const l = getFocusables(); if (l[0]) setFocus(l[0]); return; }
    if (e.tagName === 'SELECT') { e.selectedIndex = (e.selectedIndex + 1) % e.options.length; e.dispatchEvent(new Event('change', { bubbles: true })); }
    else if (e.tagName === 'INPUT' && e.type === 'range') { e.value = Number(e.value) + Number(e.step || 1) * 5; e.dispatchEvent(new Event('input', { bubbles: true })); }
    else e.click();
  };

  function tick() {
    raf = requestAnimationFrame(tick);
    if (!enabled() || window.__rpCapturing || window.__rpPadTest) return;   // capturing a binding / Test controller running
    const pads = rawPads(); if (!pads.length) return;
    const now = performance.now(); let dir = '', edge = {};
    for (const g of pads) {
      const was = prev.get(g.index) || [];
      const down = (i) => !!(g.buttons[i] && g.buttons[i].pressed);
      for (const i of [0, 1, 2, 3, 4, 5, 8, 9, 12, 13, 14, 15]) { if (down(i) && !was[i]) edge[i] = true; }
      prev.set(g.index, g.buttons.map((b) => b.pressed));
      const x = g.axes[0] || 0, y = g.axes[1] || 0;
      if (down(12) || y < -0.6) dir = 'up'; else if (down(13) || y > 0.6) dir = 'down'; else if (down(14) || x < -0.6) dir = 'left'; else if (down(15) || x > 0.6) dir = 'right';
    }
    if (Object.keys(edge).length || dir) { if (onFirstInput && now - lastActive > 3000) onFirstInput(); lastActive = now; }
    if (dir) {
      if (repeat.dir !== dir) { repeat = { dir, at: now + 380, n: 0 }; focusIn(dir); }
      else if (now >= repeat.at) { repeat.at = now + 110; focusIn(dir); }
    } else repeat.dir = '';
    if (edge[confirmIdx()]) confirm();
    if (edge[backIdx()] && onBack) onBack();
    if (edge[9] && onStart) onStart();
    if (edge[8] && onSelect) onSelect();
    if (edge[4] && onL) onL();
    if (edge[5] && onR) onR();
  }
  raf = requestAnimationFrame(tick);
  return { stop: () => cancelAnimationFrame(raf), setFocus };
}

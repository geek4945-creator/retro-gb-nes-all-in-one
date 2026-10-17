// Nintendo DS touchscreen (stylus) support for the DS cores (DeSmuME 2015, melonDS) running inside EmulatorJS 4.2.3.
//
// WHY THIS EXISTS. Both cores ship with a *relative mouse* pointer (desmume_pointer_type=mouse, melonds_touch_mode=Mouse) and EmulatorJS
// only forwards raw canvas events to RetroArch's web input driver. In that state a finger on the bottom screen does nothing useful, and
// even with the cores switched to absolute "touch" mode RetroArch only reads the FIRST finger on the page (so a thumb on a button
// makes the stylus finger invisible), top-screen touches that slide down are accepted, and a drag past the edge is dropped.
//
// HOW IT WORKS.
//  1. We switch the core to its absolute pointer mode (desmume_pointer_type=touch / melonds_touch_mode=Touch).
//  2. A transparent overlay sits over the canvas (under EmulatorJS' on-screen buttons, so the buttons keep working and multi-touch
//     works: one finger on a button, another on the stylus area). The overlay owns the touch/mouse pointer and replays ONE pointer
//     to RetroArch as synthetic mouse events on the canvas (RetroArch's rwebinput maps the mouse to pointer 0 when no real touch
//     is on the canvas). Coordinates are converted CSS px -> canvas pixels (devicePixelRatio, CSS scaling) so RetroArch's own
//     viewport translation lands on the right DS pixel.
//  3. We know where the bottom screen is (same maths RetroArch uses: aspect-fit, centred, top-aligned in portrait because EmulatorJS sets
//     video_top_portrait_viewport) so gestures that START on the top screen are ignored and drags that leave the bottom screen
//     are clamped to its edge (like a real stylus).
//  Modes: "direct" (finger = stylus position) and "trackpad" (finger moves a cursor, tap = tap, tap+drag or 2nd finger = pen down).

export const DS_CORES = {
  desmume2015: { touch: ['desmume_pointer_type', 'touch'], layoutKey: 'desmume_screens_layout' },
  melonds: { touch: ['melonds_touch_mode', 'Touch'], layoutKey: 'melonds_screen_layout' },
};
const SCREEN_W = 256, SCREEN_H = 192;
// where the BOTTOM (touch) screen is inside the core's video frame; vars = the core option value for the layout
export const LAYOUTS = {
  stacked:     { label: 'Stacked (top above bottom)',     src: [256, 384], bottom: 'lower', vars: { desmume2015: 'top/bottom', melonds: 'Top/Bottom' } },
  stackedSwap: { label: 'Stacked, swapped (bottom above top)', src: [256, 384], bottom: 'upper', vars: { desmume2015: 'bottom/top', melonds: 'Bottom/Top' } },
  side:        { label: 'Side by side (top left, bottom right)', src: [512, 192], bottom: 'right', vars: { desmume2015: 'left/right', melonds: 'Left/Right' } },
  sideSwap:    { label: 'Side by side, swapped (bottom left)', src: [512, 192], bottom: 'left', vars: { desmume2015: 'right/left', melonds: 'Right/Left' } },
  bottom:      { label: 'Bottom screen only',              src: [256, 192], bottom: 'all',   vars: { desmume2015: 'bottom only', melonds: 'Bottom Only' } },
};
export const LAYOUT_ORDER = ['auto', 'stacked', 'stackedSwap', 'side', 'sideSwap', 'bottom'];
export const LAYOUT_LABELS = { auto: 'Auto (stacked in portrait, side by side in landscape)', ...Object.fromEntries(Object.entries(LAYOUTS).map(([k, v]) => [k, v.label])) };
export const MODE_LABELS = { direct: 'Direct touch (finger = stylus)', trackpad: 'Trackpad (finger moves a cursor)' };
export const SPEEDS = [0.75, 1, 1.5, 2, 3];
export const DS_DEFAULTS = { mode: 'direct', layout: 'auto', speed: 1.5 };

export const loadDs = () => { try { return { ...DS_DEFAULTS, ...JSON.parse(localStorage.getItem('rp.ds') || '{}') }; } catch { return { ...DS_DEFAULTS }; } };
export const saveDs = (s) => { localStorage.setItem('rp.ds', JSON.stringify(s)); try { dispatchEvent(new CustomEvent('rp-ds-change')); } catch {} };
/** 'auto' -> stacked while the canvas is portrait, side by side while landscape. */
export const resolveLayout = (layout, cw, ch) => (layout && layout !== 'auto' && LAYOUTS[layout]) ? layout : (ch > cw ? 'stacked' : 'side');
/** The core options a given setting selects: [[key, value], ...] (touch mode first). */
export function coreOptions(core, settings, cw, ch) {
  const c = DS_CORES[core]; if (!c) return [];
  const lay = LAYOUTS[resolveLayout(settings.layout, cw, ch)];
  return [c.touch, [c.layoutKey, lay.vars[core]]];
}

// ------------------------------------------------------------------ geometry (pure; unit-tested)
/** RetroArch's viewport: aspect-fit the core frame (sw x sh) inside the canvas, centred, but top-aligned for a portrait canvas. */
export function viewportRect(cw, ch, sw, sh, topPortrait = true) {
  const ar = sw / sh; let w = cw, h = cw / ar;
  if (h > ch) { h = ch; w = ch * ar; }
  return { x: (cw - w) / 2, y: (topPortrait && ch > cw) ? 0 : (ch - h) / 2, w, h };
}
/** Frame size to use: the core's reported size when it matches the layout family (it includes any screen gap), else the table value. */
export function frameSize(layoutKey, reported) {
  const L = LAYOUTS[layoutKey], [tw, th] = L.src, [rw, rh] = reported || [0, 0];
  const ok = layoutKey === 'bottom' ? (rw === tw && rh === th) : L.src[0] === 256 ? (rw === 256 && rh >= th) : (rh === 192 && rw >= tw);
  return ok ? [rw, rh] : [tw, th];
}
/** { vp, bottom, top } rectangles in canvas pixels. `bottom`/`top` are the screens; top is null when only one screen is shown. */
export function screenRects(layoutKey, cw, ch, reported) {
  const [sw, sh] = frameSize(layoutKey, reported), vp = viewportRect(cw, ch, sw, sh), k = vp.w / sw, L = LAYOUTS[layoutKey];
  const rect = (sx, sy) => ({ x: vp.x + sx * k, y: vp.y + sy * k, w: SCREEN_W * k, h: SCREEN_H * k });
  switch (L.bottom) {
    case 'lower': return { vp, bottom: rect(0, sh - SCREEN_H), top: rect(0, 0) };
    case 'upper': return { vp, bottom: rect(0, 0), top: rect(0, sh - SCREEN_H) };
    case 'right': return { vp, bottom: rect(sw - SCREEN_W, 0), top: rect(0, 0) };
    case 'left':  return { vp, bottom: rect(0, 0), top: rect(sw - SCREEN_W, 0) };
    default:      return { vp, bottom: rect(0, 0), top: null };
  }
}
export const inRect = (r, x, y) => !!r && x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
export const clampTo = (r, x, y, inset = 0) => ({ x: Math.min(Math.max(x, r.x + inset), r.x + r.w - inset), y: Math.min(Math.max(y, r.y + inset), r.y + r.h - inset) });

// ------------------------------------------------------------------ the controller
const TAP_MS = 230, TAP_SLOP = 8, DRAG_WINDOW_MS = 320, PRESS_MS = 90;

export class DsTouch {
  /** emu = EmulatorJS instance (EJS_emulator); core = 'desmume2015' | 'melonds'. */
  constructor(emu, core, settings = loadDs()) {
    this.emu = emu; this.core = core; this.s = settings;
    this.canvas = emu.canvas || document.querySelector('canvas.ejs_canvas') || document.querySelector('canvas');
    this.host = this.canvas.closest('.ejs_parent') || this.canvas.parentElement;
    this.pen = null; this.ptr = new Map(); this.ignored = new Set(); this.last = { x: 0, y: 0 }; this.cursor = null; this.lastTap = { t: 0, x: 0, y: 0 };
    this.layoutKey = null; this.stats = { sent: 0 };
    this.onChange = () => { this.s = loadDs(); this.release(); this.syncCore(true); this.layoutOverlay(); };
    this.onResize = () => { this.syncCore(); this.layoutOverlay(); };
    this.build();
  }
  build() {
    const o = this.el = document.createElement('div'); o.id = 'ds-touch';
    Object.assign(o.style, { position: 'absolute', left: 0, top: 0, width: '100%', height: '100%', touchAction: 'none', userSelect: 'none', webkitUserSelect: 'none', webkitTouchCallout: 'none' });
    const dot = this.dot = document.createElement('div'); dot.id = 'ds-cursor';
    Object.assign(dot.style, { position: 'absolute', width: '16px', height: '16px', margin: '-8px 0 0 -8px', borderRadius: '50%', border: '2px solid #fff', background: 'rgba(124,92,255,.55)', boxShadow: '0 0 0 1px #000', pointerEvents: 'none', display: 'none' });
    o.append(dot);
    // right after the canvas wrapper: EmulatorJS' virtual gamepad / menus come later in the DOM so they stay on top of the overlay
    const cp = this.canvas.parentElement; cp.parentElement.insertBefore(o, cp.nextSibling);
    for (const t of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) o.addEventListener(t, (e) => this['on' + t.slice(7, 8).toUpperCase() + t.slice(8)](e), { passive: false });
    o.addEventListener('contextmenu', (e) => e.preventDefault());
    o.addEventListener('lostpointercapture', (e) => { if (this.ptr.has(e.pointerId) || this.pen === e.pointerId) this.onUp(e); });
    addEventListener('rp-ds-change', this.onChange); addEventListener('resize', this.onResize); addEventListener('orientationchange', this.onResize);
    if (window.ResizeObserver) { this.ro = new ResizeObserver(this.onResize); this.ro.observe(this.canvas); }
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.release(); });
    this.syncCore(true); this.layoutOverlay();
    // EmulatorJS (re)applies its own stored core options shortly after start: assert ours again
    for (const ms of [400, 1500]) setTimeout(() => { this.syncCore(true); this.layoutOverlay(); }, ms);
    try { this.emu.enableMouseLock = false; } catch {}            // pointer lock would turn the desktop mouse into a relative one
  }
  stop() { this.release(); this.ro && this.ro.disconnect(); removeEventListener('rp-ds-change', this.onChange); removeEventListener('resize', this.onResize); removeEventListener('orientationchange', this.onResize); this.el.remove(); }

  // ---- core options
  size() { return [this.canvas.width || 1, this.canvas.height || 1]; }
  reported() { try { const g = this.emu.gameManager; return [g.getVideoDimensions('width'), g.getVideoDimensions('height')]; } catch { return null; } }
  syncCore(force) {
    const [cw, ch] = this.size(), key = resolveLayout(this.s.layout, cw, ch);
    if (!force && key === this.layoutKey) return;
    this.layoutKey = key;
    try { for (const [k, v] of coreOptions(this.core, this.s, cw, ch)) this.emu.gameManager.setVariable(k, v); } catch (e) { console.warn('DS option sync failed', e); }
    if (this.dot) this.dot.style.display = 'none';
  }
  rects() { const [cw, ch] = this.size(); return screenRects(resolveLayout(this.s.layout, cw, ch), cw, ch, this.reported()); }
  /** canvas px -> client px and back (the canvas may be CSS-scaled) */
  box() { const r = this.canvas.getBoundingClientRect(), [cw, ch] = this.size(); return { r, sx: r.width / cw, sy: r.height / ch }; }
  clientRect(rc) { const { r, sx, sy } = this.box(); return rc && { x: r.left + rc.x * sx, y: r.top + rc.y * sy, w: rc.w * sx, h: rc.h * sy }; }
  screens() { const s = this.rects(); return { bottom: this.clientRect(s.bottom), top: this.clientRect(s.top), vp: this.clientRect(s.vp) }; }
  layoutOverlay() {
    const { r } = this.box(), h = this.host.getBoundingClientRect();
    Object.assign(this.el.style, { left: r.left - h.left + 'px', top: r.top - h.top + 'px', width: r.width + 'px', height: r.height + 'px' });
    if (this.s.mode === 'trackpad') { if (!this.cursor) this.centerCursor(); this.paintCursor(); } else this.dot.style.display = 'none';
  }
  centerCursor() { const b = this.screens().bottom; if (b) this.cursor = { x: b.x + b.w / 2, y: b.y + b.h / 2 }; }
  paintCursor() {
    if (!this.cursor) return; const h = this.host.getBoundingClientRect();
    Object.assign(this.dot.style, { display: 'block', left: this.cursor.x - h.left + 'px', top: this.cursor.y - h.top + 'px', background: this.pen != null ? 'rgba(255,255,255,.85)' : 'rgba(124,92,255,.55)' });
  }

  // ---- replay to RetroArch: a synthetic mouse event on the canvas at a client position (converted so RetroArch's dpr maths is exact)
  send(type, x, y) {
    const { r, sx, sy } = this.box(), dpr = window.devicePixelRatio || 1;
    const cx = (x - r.left) / sx, cy = (y - r.top) / sy;         // canvas pixels
    this.canvas.dispatchEvent(new MouseEvent(type, { clientX: r.left + cx / dpr, clientY: r.top + cy / dpr, button: 0, buttons: type === 'mouseup' ? 0 : 1, bubbles: false, cancelable: true, view: window }));
    this.last = { x, y }; this.stats.sent++; this.stats.lastType = type; this.stats.lastCanvas = [cx, cy];
  }
  paused() { try { return !!this.emu.paused; } catch { return false; } }
  press(x, y) { this.send('mousemove', x, y); this.send('mousedown', x, y); }
  lift() { if (this.pen == null) return; this.send('mouseup', this.last.x, this.last.y); this.pen = null; this.paintCursor(); }
  release() { this.lift(); this.ptr.clear(); this.ignored.clear(); clearTimeout(this.tapTimer); }

  // ---- pointer events
  onDown(e) {
    if (this.paused() || (e.pointerType === 'mouse' && e.button !== 0)) return;
    e.preventDefault();
    const sc = this.screens(), x = e.clientX, y = e.clientY;
    try { this.el.setPointerCapture(e.pointerId); } catch {}
    if (this.s.mode === 'trackpad') return this.padDown(e, sc);
    // direct: only a gesture that STARTS on the bottom screen is the stylus; a finger on the top screen (or a 2nd finger) is ignored
    if (this.pen != null || !inRect(sc.bottom, x, y)) { this.ignored.add(e.pointerId); return; }
    this.pen = e.pointerId; this.press(x, y);
  }
  onMove(e) {
    if (this.s.mode === 'trackpad') return this.padMove(e);
    if (e.pointerId !== this.pen || this.paused()) return;
    e.preventDefault();
    const b = this.screens().bottom, p = clampTo(b, e.clientX, e.clientY, 1.5 * this.box().sx);   // a real stylus saturates at the screen edge
    this.send('mousemove', p.x, p.y);
  }
  onUp(e) {
    this.ignored.delete(e.pointerId);
    try { this.el.releasePointerCapture(e.pointerId); } catch {}
    if (this.s.mode === 'trackpad') return this.padUp(e);
    if (e.pointerId === this.pen) { e.cancelable && e.preventDefault(); this.lift(); }
  }
  onCancel(e) { this.onUp(e); }

  // ---- trackpad style
  padDown(e, sc) {
    const x = e.clientX, y = e.clientY, now = performance.now();
    if (sc.top && inRect(sc.top, x, y) && !this.ptr.size) { this.ignored.add(e.pointerId); return; }     // never start on the top screen
    if (!this.cursor) this.centerCursor(); if (!this.cursor) return;
    const moving = [...this.ptr.values()].find((p) => p.role !== 'press');
    const st = { x, y, sx: x, sy: y, t0: now, moved: false, role: moving ? 'press' : 'move' };
    if (st.role === 'move' && now - this.lastTap.t < DRAG_WINDOW_MS && Math.hypot(this.cursor.x - this.lastTap.x, this.cursor.y - this.lastTap.y) < 30 && this.pen == null) st.role = 'drag';
    // a tap's pen-down may still be showing (PRESS_MS): a new finger within the drag window takes it over
    if (st.role === 'move' && this.pen === -1 && now - this.lastTap.t < DRAG_WINDOW_MS && Math.hypot(this.cursor.x - this.lastTap.x, this.cursor.y - this.lastTap.y) < 30) { st.role = 'drag'; this.pen = e.pointerId; clearTimeout(this.tapTimer); this.ptr.set(e.pointerId, st); return; }
    this.ptr.set(e.pointerId, st);
    if ((st.role === 'press' || st.role === 'drag') && this.pen == null) { this.pen = e.pointerId; this.press(this.cursor.x, this.cursor.y); this.paintCursor(); }
  }
  padMove(e) {
    const st = this.ptr.get(e.pointerId); if (!st || st.role === 'press' || this.paused()) return;
    e.preventDefault();
    const b = this.screens().bottom, k = this.s.speed || 1.5;
    const p = clampTo(b, this.cursor.x + (e.clientX - st.x) * k, this.cursor.y + (e.clientY - st.y) * k, 1.5 * this.box().sx);
    st.x = e.clientX; st.y = e.clientY; this.cursor = p;
    if (Math.hypot(e.clientX - st.sx, e.clientY - st.sy) > TAP_SLOP) st.moved = true;
    if (this.pen != null) this.send('mousemove', p.x, p.y);
    this.paintCursor();
  }
  padUp(e) {
    const st = this.ptr.get(e.pointerId); this.ptr.delete(e.pointerId); if (!st) return;
    if (this.pen === e.pointerId) { this.lift(); if (st.role === 'drag') this.lastTap = { t: 0, x: 0, y: 0 }; return; }
    if (st.role === 'move' && !st.moved && performance.now() - st.t0 < TAP_MS && this.pen == null) {     // a tap: pen down at the cursor for a moment
      this.pen = -1; this.press(this.cursor.x, this.cursor.y); this.paintCursor(); this.lastTap = { t: performance.now(), x: this.cursor.x, y: this.cursor.y };
      this.tapTimer = setTimeout(() => { if (this.pen === -1) this.lift(); }, PRESS_MS);
    } else if (st.role === 'move') this.lastTap = { t: 0, x: 0, y: 0 };
  }
}

/** Called by the player for DS games. Returns the controller (also exposed as window.__rpDs for tests). */
export function startDsTouch(emu, core) {
  if (!DS_CORES[core]) return null;
  const d = new DsTouch(emu, core); window.__rpDs = d; return d;
}
/** Core options to preload (before the emulator starts) so the very first frame already uses absolute touch. */
export function initialOptions(core, settings = loadDs(), cw = innerWidth, ch = innerHeight) {
  return Object.fromEntries(coreOptions(core, settings, cw, ch));
}

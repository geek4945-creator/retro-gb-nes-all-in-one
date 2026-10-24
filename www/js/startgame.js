// "Start Game" without touching the screen: A / Start / Cross on a controller (Gamepad API) or Enter / Space on a
// keyboard starts the game exactly like tapping EmulatorJS' start button, which itself sits at the TOP of the screen
// (player.css) so phone navigation buttons never cover it. The starting press is swallowed so it never reaches the game.
//
// iOS / Safari only unlock audio on a touch, click or key press, never on a controller button. A game started from a
// controller therefore starts muted on iPhone; every AudioContext is tracked and resumed on the next touch or key.
const START_BUTTONS = [0, 9];            // standard mapping: 0 = A / Cross / South, 9 = Start / Options / Menu
const START_KEYS = new Set(['Enter', 'NumpadEnter', ' ', 'Spacebar']);

/* ---------- audio contexts (patched before EmulatorJS loads, so the core's OpenAL context is tracked too) ---------- */
const ctxs = new Set();
export function trackAudio() {
  for (const k of ['AudioContext', 'webkitAudioContext']) {
    const Orig = window[k]; if (!Orig || Orig.__rpTracked) continue;
    const Tracked = class extends Orig { constructor(...a) { super(...a); ctxs.add(this); } };
    Tracked.__rpTracked = true; window[k] = Tracked;
  }
}
export const audioContexts = () => [...ctxs];
export function audioBlocked() { return [...ctxs].some((c) => c.state === 'suspended'); }
export function resumeAllAudio() { for (const c of ctxs) if (c.state === 'suspended') { try { c.resume(); } catch {} } }

/** Watch for EmulatorJS' start button; start on a controller / keyboard press too. */
export function initStartButton({ rawPads, swallow, onPadStart } = {}) {
  let btn = null, hint = null, raf = 0, prev = new Map(), keyStarted = null, attachedAt = 0;
  const isiOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const text = () => `Tap Start Game — or press A / Start on your controller${matchMedia('(pointer:fine)').matches || !isiOS ? ' (Enter / Space on a keyboard)' : ''}${isiOS ? '. Sound turns on with your first tap' : ''}`;
  function start(by) {
    if (!btn || !btn.isConnected) return false;
    window.__rpStartedBy = by;
    const b = btn; detach();
    b.click();                                   // same code path as a tap (EmulatorJS removes the button itself)
    return true;
  }
  function poll() {
    raf = requestAnimationFrame(poll);
    if (!btn || !btn.isConnected) return detach();
    for (const g of rawPads()) {
      const was = prev.get(g.index), now = START_BUTTONS.map((i) => !!(g.buttons[i] && g.buttons[i].pressed));
      prev.set(g.index, now);
      // Chrome only reveals a pad after one of its buttons is pressed, so a press seen at first sight counts too,
      // except right after the button appeared (a button still held from launching the game in the library).
      if (!was && performance.now() - attachedAt < 600) continue;
      const hit = now.findIndex((p, k) => p && !(was && was[k]));
      if (hit >= 0) { swallow && swallow(g.index, START_BUTTONS); if (start('pad')) { onPadStart && onPadStart(g); return; } }
    }
  }
  function onKey(e) {
    if (e.type === 'keyup') { if (keyStarted === e.key) { keyStarted = null; e.preventDefault(); e.stopImmediatePropagation(); } return; }
    if (!btn || !btn.isConnected || !START_KEYS.has(e.key) || e.repeat) return;
    const t = e.target; if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    e.preventDefault(); e.stopImmediatePropagation(); keyStarted = e.key;   // the game never sees this key down or up
    start('key');
  }
  function attach(b) {
    if (btn === b) return; btn = b; prev = new Map(); attachedAt = performance.now();
    b.setAttribute('role', 'button'); b.setAttribute('aria-label', 'Start game (or press A / Start on a controller)');
    hint = document.getElementById('start-hint') || Object.assign(document.createElement('div'), { id: 'start-hint' });
    hint.textContent = text(); hint.hidden = false; document.body.append(hint);
    cancelAnimationFrame(raf); raf = requestAnimationFrame(poll);
  }
  function detach() { btn = null; cancelAnimationFrame(raf); raf = 0; if (hint) hint.hidden = true; }
  addEventListener('keydown', onKey, true); addEventListener('keyup', onKey, true);
  const find = () => { const b = document.querySelector('.ejs_start_button'); if (b && b !== btn) attach(b); else if (!b && btn) detach(); };
  new MutationObserver(find).observe(document.body, { childList: true, subtree: true });
  find();
  return { start, get button() { return btn; } };
}

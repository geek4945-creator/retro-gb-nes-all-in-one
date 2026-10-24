// Keeps every sheet's Close / Back / Save actions at the TOP of the screen, inside the safe area.
// Phones with on-screen navigation buttons (Android 3-button bar, iPhone home indicator) cover the bottom
// edge, so nothing you have to tap may live there. Sheets are built by many modules with replaceChildren();
// a MutationObserver lifts the action buttons into a sticky `.sheet-top` bar every time a sheet is (re)drawn.
const ACTION_RE = /^(‹\s*)?(close|back|done|cancel|save)\b/i;

/** True for a button that belongs in the top action bar. Opt in with data-top, opt out with data-bottom. */
export function isTopAction(b) {
  if (!b || b.tagName !== 'BUTTON' || b.hasAttribute('data-bottom')) return false;
  if (b.hasAttribute('data-top') || b.id === 'btn-net-save') return true;
  return b.classList.contains('row') && b.classList.contains('ghost') && ACTION_RE.test(b.textContent.trim());
}

/** Move a dialog's direct-child action buttons (and its title) into the sticky top bar. Idempotent. */
export function hoist(d) {
  let bar = d.querySelector(':scope > .sheet-top');
  const acts = [...d.children].filter((c) => c !== bar && isTopAction(c));
  if (!acts.length) return bar;
  if (!bar) { bar = document.createElement('div'); bar.className = 'sheet-top'; }
  if (d.firstElementChild !== bar) d.prepend(bar);
  const title = bar.nextElementSibling;
  if (title && /^H[1-4]$/.test(title.tagName) && !bar.querySelector('.sheet-title')) { title.classList.add('sheet-title'); bar.prepend(title); }
  const btns = bar.querySelector('.sheet-acts') || bar.appendChild(Object.assign(document.createElement('div'), { className: 'sheet-acts' }));
  // Save-type actions first (primary, rightmost reads as "Back / Save"), then Back / Close
  for (const a of acts) { a.classList.add('top-act'); if (/save/i.test(a.textContent) || a.id === 'btn-net-save') { a.classList.add('top-save'); btns.append(a); } else btns.prepend(a); }
  return bar;
}

const watched = new WeakSet();
export function initTopBars(root = document) {
  for (const d of root.querySelectorAll('dialog.sheet')) {
    if (watched.has(d)) continue; watched.add(d);
    hoist(d);
    new MutationObserver(() => hoist(d)).observe(d, { childList: true });
    d.addEventListener('close', () => { d.scrollTop = 0; });
  }
}

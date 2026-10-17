// "Is there a newer version?" — for the installed web app (PWA) and the Android APK.
//   * BUILD (js/version.js, stamped in CI) is what THIS running code is; build-info.json (never cached) is what is deployed now.
//   * PWA: a newer service worker installs in the background and waits; we show "Update available — Reload" and the Reload button
//     tells the waiting worker to take over, then reloads (so a running session never mixes old and new files).
//   * APK (Capacitor): the web files are bundled, so a newer build means a newer APK: we link to the latest release.
import { BUILD, VERSION } from './version.js';

export const PAGES_URL = 'https://geek4945-creator.github.io/retro-gb-nes-all-in-one/';
export const APK_URL = 'https://github.com/geek4945-creator/retro-gb-nes-all-in-one/releases/download/latest/RetroPocket-debug.apk';
export const isApk = () => !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
export const currentBuild = () => ({ build: BUILD, version: VERSION });

let reg = null, bannerEl = null, reloading = false;

export async function fetchLatest() {
  const url = (isApk() || !location.protocol.startsWith('http') ? PAGES_URL : new URL('./', location.href).href) + 'build-info.json?t=' + Date.now();
  const r = await fetch(url, { cache: 'no-store' }); if (!r.ok) throw new Error('HTTP ' + r.status);
  const j = await r.json(); if (!Number.isFinite(j.build)) throw new Error('bad build-info'); return j;
}

function showBanner(text, actionLabel, action) {
  if (!bannerEl) { bannerEl = document.createElement('div'); bannerEl.id = 'update-banner'; bannerEl.setAttribute('role', 'status'); document.body.append(bannerEl); }
  const msg = Object.assign(document.createElement('span'), { textContent: text });
  const go = Object.assign(document.createElement('button'), { id: 'update-go', textContent: actionLabel, onclick: action });
  const x = Object.assign(document.createElement('button'), { className: 'ghost', textContent: '✕', ariaLabel: 'Dismiss', onclick: () => { bannerEl.hidden = true; } });
  bannerEl.replaceChildren(msg, go, x); bannerEl.hidden = false;
}

/** Make the waiting service worker active and reload once (guarded against reload loops). */
export async function applyUpdate() {
  if (isApk()) { location.href = APK_URL; return; }
  const r = reg || (navigator.serviceWorker && await navigator.serviceWorker.getRegistration());
  if (r) { try { await r.update(); } catch {} }
  if (r && r.waiting) { r.waiting.postMessage('skip-waiting'); setTimeout(() => { if (!reloading) { reloading = true; location.reload(); } }, 1500); }   // controllerchange normally reloads first
  else { reloading = true; location.reload(); }
}

function offerWeb(info) { showBanner(`Update available (version ${info.version}).`, 'Reload', applyUpdate); }

/** manual = from the Settings button: returns a status line for the toast; automatic checks only show the banner when newer. */
export async function checkForUpdates({ manual = false } = {}) {
  let status = '';
  try { if (reg) await reg.update(); } catch {}
  try {
    const latest = await fetchLatest();
    if (latest.build > BUILD) {
      if (isApk()) showBanner(`New app version ${latest.version} is available.`, 'Download APK', () => { location.href = APK_URL; });
      else offerWeb(latest);
      status = isApk() ? `New version ${latest.version} available — download the APK` : `Update available: version ${latest.version}`;
    } else status = BUILD ? `You are up to date (version ${VERSION})` : 'Development build (no version stamp)';
  } catch (e) {
    status = reg && reg.waiting ? 'Update ready' : (manual ? 'Could not check for updates (offline?)' : '');
  }
  if (reg && reg.waiting && !isApk()) offerWeb({ version: 'ready' });
  return status;
}

export async function initUpdates() {
  if (!('serviceWorker' in navigator) || !location.protocol.startsWith('http')) { setTimeout(() => checkForUpdates(), 3000); return; }
  try { reg = await navigator.serviceWorker.register('sw.js'); } catch (e) { console.warn('SW registration failed', e); return; }
  const watch = (w) => w && w.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) offerWeb({ version: 'ready' }); });
  if (reg.waiting && navigator.serviceWorker.controller) offerWeb({ version: 'ready' });
  watch(reg.installing); reg.addEventListener('updatefound', () => watch(reg.installing));
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (!reloading && document.getElementById('update-banner') && !document.getElementById('update-banner').hidden) { reloading = true; location.reload(); } });
  setTimeout(() => checkForUpdates(), 2500);
  let last = Date.now();
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && Date.now() - last > 10 * 60 * 1000) { last = Date.now(); checkForUpdates(); } });
}

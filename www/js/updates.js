// "Is there a newer version?" — for the installed web app (PWA) and the Android APK.
//   * BUILD (js/version.js, stamped in CI) is what THIS running code is; build-info.json (never cached) is what is deployed now.
//   * PWA: a newer service worker installs in the background and waits; we show "Update available — Reload" and the Reload button
//     tells the waiting worker to take over, then reloads (so a running session never mixes old and new files).
//   * APK (Capacitor): the web files are bundled, so a newer build means a newer APK. "Update now" downloads it INSIDE the app with
//     the native AppUpdater plugin (android/.../AppUpdaterPlugin.java): progress + cancel, then the plugin verifies the file (valid APK,
//     same package, same signing certificate, higher versionCode) and opens the Android package installer. Android 8+ needs
//     "Install unknown apps" for Retro Pocket once: we explain it, open that settings page and continue when the user comes back.
//     No plugin (older APK) or a download error -> the old browser download link.
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

function showBanner(text, actionLabel, action, extra = []) {
  if (!bannerEl) { bannerEl = document.createElement('div'); bannerEl.id = 'update-banner'; bannerEl.setAttribute('role', 'status'); document.body.append(bannerEl); }
  const msg = Object.assign(document.createElement('span'), { textContent: text });
  const btns = actionLabel ? [Object.assign(document.createElement('button'), { id: 'update-go', textContent: actionLabel, onclick: action })] : [];
  const x = Object.assign(document.createElement('button'), { className: 'ghost', textContent: '✕', ariaLabel: 'Dismiss', onclick: () => { bannerEl.hidden = true; } });
  bannerEl.classList.remove('error');
  bannerEl.replaceChildren(msg, ...extra, ...btns, x); bannerEl.hidden = false;
  return bannerEl;
}

// ---------- APK: native in-app update (AppUpdater plugin) ----------
const NATIVE = 'AppUpdater';
const VERIFY_CODES = new Set(['BAD_APK', 'WRONG_PACKAGE', 'WRONG_SIGNER', 'NOT_NEWER']);
export const hasNativeUpdater = () => isApk() && !!(window.Capacitor.nativePromise && window.Capacitor.isPluginAvailable && window.Capacitor.isPluginAvailable(NATIVE));
const native = (method, opts = {}) => window.Capacitor.nativePromise(NATIVE, method, opts);
let downloading = false, waitingForPermission = null;
const mb = (n) => (n / 1048576).toFixed(1);

/** The pre-plugin behaviour: let the browser download the APK from the release. */
export function browserDownload() { location.href = APK_URL; }

function showProgress(d) {
  const pct = d && d.percent >= 0 ? d.percent : null;
  const text = 'Downloading update… ' + (pct === null ? (d && d.received ? mb(d.received) + ' MB' : '') : `${pct}%` + (d.total > 0 ? ` · ${mb(d.received)} / ${mb(d.total)} MB` : ''));
  if (bannerEl && !bannerEl.hidden && bannerEl.querySelector('#update-progress')) {
    bannerEl.querySelector('span').textContent = text; const bar = bannerEl.querySelector('#update-progress');
    if (pct === null) bar.removeAttribute('value'); else bar.value = pct; return;
  }
  const bar = Object.assign(document.createElement('progress'), { id: 'update-progress', max: 100 }); if (pct !== null) bar.value = pct;
  const cancel = Object.assign(document.createElement('button'), { id: 'update-cancel', className: 'secondary', textContent: 'Cancel', onclick: () => native('cancel').catch(() => {}) });
  showBanner(text, '', null, [bar, cancel]);
}

function showError(text, actionLabel, action) { showBanner(text, actionLabel, action).classList.add('error'); }

const permissionText = 'Allow Retro Pocket to “Install unknown apps” to update, then come back.';

/** Hand a verified download to the Android installer, asking for "Install unknown apps" first when needed. */
function askPermission(info) {
  waitingForPermission = info;
  showBanner(permissionText, 'Open settings', async () => {
    const s = await native('openInstallSettings').catch(() => ({ allowed: false }));
    if (s && s.allowed) installDownloaded(info);           // the user came back with the permission granted -> continue
  });
  return 'permission';
}

let lastInstall = { path: '', t: 0 };
/** Hand a verified download to the Android installer, asking for "Install unknown apps" first when needed. */
export async function installDownloaded(info) {
  try {
    const { allowed } = await native('canInstall');
    if (!allowed) return askPermission(info);
    waitingForPermission = null;
    if (lastInstall.path === info.path && Date.now() - lastInstall.t < 3000) return 'installer';   // settings result + visibilitychange both fire
    lastInstall = { path: info.path, t: Date.now() };
    await native('install', { path: info.path });
    showBanner(`Installing version ${info.versionName || ''}… confirm in the Android installer.`, 'Install', () => { lastInstall.t = 0; installDownloaded(info); });
    return 'installer';
  } catch (e) {
    const code = e && e.code;
    if (code === 'NEEDS_PERMISSION') return askPermission(info);
    if (VERIFY_CODES.has(code)) { showError('Update not installed: ' + e.message); return 'rejected'; }
    if (code === 'MISSING') { showBanner(e.message, 'Update now', () => updateNow()); return 'missing'; }
    showError(`Could not open the installer (${(e && e.message) || e}).`, 'Download APK', browserDownload); return 'failed';
  }
}

/** "Update now": download inside the app with progress/cancel, verify, install. Falls back to the browser download without the plugin. */
export async function updateNow() {
  if (!hasNativeUpdater()) { browserDownload(); return 'browser'; }
  if (downloading) return 'busy';
  downloading = true; let sub = null;
  try {
    showProgress({ percent: 0, received: 0, total: 0 });
    try { sub = window.Capacitor.addListener(NATIVE, 'progress', (d) => { if (d && downloading) showProgress(d); }); } catch {}
    const info = await native('download', { url: APK_URL });
    pendingDownload = info;
    downloading = false;
    return await installDownloaded(info);
  } catch (e) {
    downloading = false;
    const code = e && e.code;
    if (code === 'CANCELLED') { showBanner('Update download cancelled.', 'Update now', () => updateNow()); return 'cancelled'; }
    if (VERIFY_CODES.has(code)) { showError('Update not installed: ' + e.message); return 'rejected'; }
    showError(`In-app download failed (${(e && e.message) || e}). Download it in the browser instead?`, 'Download APK', browserDownload); return 'failed';
  } finally {
    downloading = false; if (sub) try { sub.remove(); } catch {}
  }
}

/** APK start-up: delete stale downloads; if a verified newer download is waiting (e.g. Android restarted the app after the permission screen), offer it. */
async function resumePending() {
  if (!hasNativeUpdater()) return;
  try {
    const p = await native('pending');
    if (p && p.path) { pendingDownload = p; offerPending(p); }
  } catch {}
}
let pendingDownload = null;
const offerPending = (p) => showBanner(`Update ${p.versionName || ''} is downloaded.`, 'Install now', () => installDownloaded(p));

function offerApk(latest) {
  if (downloading) return;
  if (pendingDownload && pendingDownload.versionCode >= 1000 + latest.build) return offerPending(pendingDownload);   // already downloaded: no second download
  if (hasNativeUpdater()) showBanner(`New app version ${latest.version} is available.`, 'Update now', () => updateNow());
  else showBanner(`New app version ${latest.version} is available.`, 'Download APK', browserDownload);
}

/** Make the waiting service worker active and reload once (guarded against reload loops). */
export async function applyUpdate() {
  if (isApk()) { await updateNow(); return; }
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
      if (isApk()) offerApk(latest); else offerWeb(latest);
      status = isApk() ? `New version ${latest.version} available — ${hasNativeUpdater() ? 'tap Update now' : 'download the APK'}` : `Update available: version ${latest.version}`;
    } else status = BUILD ? `You are up to date (version ${VERSION})` : 'Development build (no version stamp)';
  } catch (e) {
    status = reg && reg.waiting ? 'Update ready' : (manual ? 'Could not check for updates (offline?)' : '');
  }
  if (reg && reg.waiting && !isApk()) offerWeb({ version: 'ready' });
  return status;
}

export async function initUpdates() {
  if (isApk()) {
    resumePending();
    document.addEventListener('visibilitychange', async () => {      // back from the "Install unknown apps" screen (opened by Android or by us)
      if (document.visibilityState !== 'visible' || !waitingForPermission || !hasNativeUpdater()) return;
      try { if ((await native('canInstall')).allowed) installDownloaded(waitingForPermission); } catch {}
    });
  }
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

// "Is there a newer version?" — for the installed web app (PWA) and the Android APK. ONLY answered in Settings → Check for updates:
//   there is no automatic check and no banner on the main screen (1.0.29). Everything (status, Update now / Reload, APK download
//   progress, "Install unknown apps", errors) is shown in a panel right below that Settings button (#update-panel).
//   * BUILD (js/version.js, stamped in CI) is what THIS running code is; build-info.json (never cached) is what is deployed now.
//     Both are the commit count of the same commit (APK versionCode = 1000 + build), so "newer" means build-info.build > BUILD.
//   * PWA: a newer service worker installs in the background and waits; it is activated silently on the NEXT launch (before
//     the library is shown), or at once with "Reload" in Settings. A running session never mixes old and new files.
//   * APK (Capacitor): the web files are bundled, so a newer build means a newer APK. "Update now" downloads it INSIDE the app with
//     the native AppUpdater plugin (android/.../AppUpdaterPlugin.java): progress + cancel, then the plugin verifies the file (valid APK,
//     same package, same signing certificate, higher versionCode) and opens the Android package installer. Android 8+ needs
//     "Install unknown apps" for Retro Pocket once: we explain it, open that settings page and continue when the user comes back.
//     No plugin (older APK) or a download error -> the old browser download link.
//   Old false positive (fixed): the bundled service worker of the APK changes with every APK; after an update the new worker sat
//   "waiting" forever (in the APK "Reload" meant "download the APK"), and every launch showed "Update available (version ready)".
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
/** Build number from build-info / BUILD / a versionCode (1000 + build) / a "1.0.N" version. */
export const buildOf = (x) => { const n = Number(x); if (Number.isFinite(n) && n > 0) return n >= 1000 ? n - 1000 : n; const m = /^1\.0\.(\d+)$/.exec(String(x || '')); return m ? Number(m[1]) : 0; };
/** Is `latest` (build-info.json) newer than this running build? A dev checkout (BUILD 0) never claims an update. */
export const isNewer = (latest, current = BUILD) => !!latest && buildOf(current) > 0 && buildOf(latest.build) > buildOf(current);

/** The update panel shown below Settings → Check for updates (created once, keeps its state while Settings is closed). */
export function updatePanel() {
  if (!bannerEl) { bannerEl = document.createElement('div'); bannerEl.id = 'update-panel'; bannerEl.className = 'update-panel'; bannerEl.setAttribute('role', 'status'); bannerEl.hidden = true; }
  return bannerEl;
}
/** Optional little dot on the ⚙︎ Settings button while something needs attention (never a banner). */
function dot(on) { const b = document.getElementById('btn-settings'); if (b) b.classList.toggle('has-update', !!on); }

function showBanner(text, actionLabel, action, extra = []) {
  const p = updatePanel();
  const msg = Object.assign(document.createElement('span'), { textContent: text });
  const btns = actionLabel ? [Object.assign(document.createElement('button'), { id: 'update-go', type: 'button', textContent: actionLabel, onclick: action })] : [];
  p.classList.remove('error');
  p.replaceChildren(msg, ...extra, ...btns); p.hidden = false;
  dot(!!actionLabel || extra.length);
  return p;
}
function showStatus(text) { const p = updatePanel(); p.classList.remove('error'); p.replaceChildren(Object.assign(document.createElement('span'), { textContent: text })); p.hidden = false; dot(false); }

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

/** Settings → Check for updates. Returns the status line (also shown in the panel). Never called automatically. */
export async function checkForUpdates({ manual = true } = {}) {
  let status = '';
  if (downloading) return 'Downloading update…';
  try { if (reg) await reg.update(); } catch {}
  try {
    const latest = await fetchLatest();
    if (isNewer(latest)) {
      if (isApk()) offerApk(latest); else offerWeb(latest);
      status = isApk() ? `New version ${latest.version} available — ${hasNativeUpdater() ? 'tap Update now' : 'download the APK'}` : `Update available: version ${latest.version}`;
    } else {
      status = BUILD ? `You're up to date (version ${VERSION})` : 'Development build (no version stamp)';
      if (isApk() && pendingDownload) { offerPending(pendingDownload); return status; }
      showStatus(status);
    }
  } catch (e) {
    status = manual ? 'Could not check for updates (offline?)' : '';
    if (status) showStatus(status);
  }
  return status;
}

/** A worker that finished installing in an EARLIER session is activated now, silently, before the user does anything. */
async function applyWaitingOnLaunch(r) {
  if (!r || !r.waiting || !navigator.serviceWorker.controller) return false;
  const k = 'rp.swApplied', last = Number(sessionStorage.getItem(k) || 0);
  if (Date.now() - last < 30000) return false;                       // never loop
  sessionStorage.setItem(k, String(Date.now()));
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (!reloading) { reloading = true; location.reload(); } }, { once: true });
  r.waiting.postMessage('skip-waiting');
  setTimeout(() => { if (!reloading && r.waiting) r.waiting.postMessage('skip-waiting'); }, 3000);   // busy device: ask once more
  return true;
}

export async function initUpdates() {
  if (isApk()) {
    resumePending();
    document.addEventListener('visibilitychange', async () => {      // back from the "Install unknown apps" screen (opened by Android or by us)
      if (document.visibilityState !== 'visible' || !waitingForPermission || !hasNativeUpdater()) return;
      try { if ((await native('canInstall')).allowed) installDownloaded(waitingForPermission); } catch {}
    });
  }
  if (!('serviceWorker' in navigator) || !location.protocol.startsWith('http')) return;
  try { reg = await navigator.serviceWorker.register('sw.js'); } catch (e) { console.warn('SW registration failed', e); return; }
  // No banner for a waiting worker (that was the "update on the cover screen even though I'm current" prompt): it is applied on
  // the next launch, or right away by Settings → Check for updates → Reload.
  await applyWaitingOnLaunch(reg);
}

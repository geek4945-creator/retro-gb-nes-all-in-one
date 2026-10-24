// In-app APK update flow (www/js/updates.js + the native AppUpdater plugin), headless Chrome with a MOCKED plugin
// (the Java side, android/.../AppUpdaterPlugin.java, is compiled by the APK workflow; it cannot run here):
//   newer build -> "Update now" -> progress % + Cancel -> cancel -> retry -> verified download -> "Install unknown apps" not allowed
//   -> one-line explanation + Open settings -> back with permission -> installer opened with the downloaded path;
//   permission granted outside the app + return (visibilitychange) also resumes; signature / version check failures never install;
//   network failure and a missing plugin fall back to the browser download link; a waiting download is offered in Settings.
// Since 1.0.29 all of this lives in Settings → Check for updates (#update-panel); nothing is ever shown on the main screen by itself.
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
const PORT = Number(process.env.PORT || 18000 + Math.floor(Math.random() * 20000)), base = `http://localhost:${PORT}/`;
const APK_URL = 'https://github.com/geek4945-creator/retro-gb-nes-all-in-one/releases/download/latest/RetroPocket-debug.apk';
const srv = spawn('python3', ['-m', 'http.server', String(PORT), '--directory', 'www'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0, total = 0;
const step = async (n, f) => { total++; try { const v = await f(); console.log('PASS', n, v ?? ''); } catch (e) { failed++; console.log('FAIL', n, '->', e.message); } };
const assert = (c, m) => { if (!c) throw new Error(m || 'assertion failed'); };
await sleep(800);
const browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: 'new', protocolTimeout: 120000, args: ['--no-sandbox'] });

// mock of the native bridge + AppUpdater plugin; window.__mock controls the behaviour, window.__calls records method calls
function mockBridge(plugin, initial) {
  const m = window.__mock = Object.assign({ allowed: true, downloadError: null, installError: null, pending: {}, steps: 10, stepMs: 60 }, initial || {});
  const calls = window.__calls = [], listeners = [];
  let cancel = null;
  const err = (code, message) => Object.assign(new Error(message), { code });
  window.Capacitor = {
    isNativePlatform: () => true,
    isPluginAvailable: (n) => plugin && n === 'AppUpdater',
    addListener: (p, ev, cb) => { const l = { p, ev, cb }; listeners.push(l); return { remove: async () => listeners.splice(listeners.indexOf(l), 1) }; },
    nativePromise: (p, method, opts) => {
      calls.push({ method, opts });
      if (p !== 'AppUpdater') return Promise.reject(err('UNIMPLEMENTED', 'no plugin ' + p));
      switch (method) {
        case 'canInstall': return Promise.resolve({ allowed: m.allowed });
        case 'openInstallSettings': return new Promise((res) => setTimeout(() => { if (m.grantInSettings) m.allowed = true; res({ allowed: m.allowed }); }, 100));
        case 'cancel': if (cancel) cancel(); return Promise.resolve();
        case 'pending': return Promise.resolve(m.pending);
        case 'install': return m.installError ? Promise.reject(err(m.installError, 'install failed: ' + m.installError)) : Promise.resolve({ started: true });
        case 'download': return new Promise((res, rej) => {
          let i = 0; const totalB = 4334784;
          cancel = () => { clearInterval(t); rej(err('CANCELLED', 'Download cancelled')); };
          const t = setInterval(() => {
            i++; const received = Math.round(totalB * i / m.steps);
            listeners.filter((l) => l.ev === 'progress').forEach((l) => l.cb({ received, total: totalB, percent: Math.floor(received * 100 / totalB) }));
            if (i >= m.steps) {
              clearInterval(t); cancel = null;
              if (m.downloadError) rej(err(m.downloadError, m.downloadError === 'NETWORK' ? 'Download failed: HTTP 503' : 'The download is signed with a different key'));
              else res({ path: '/data/user/0/com.retropocket.app/cache/updates/RetroPocket-update-1.apk', versionCode: 1103, versionName: '1.0.103-abc', packageName: 'com.retropocket.app', size: totalB });
            }
          }, m.stepMs);
        });
      }
      return Promise.reject(err('UNIMPLEMENTED', method));
    },
  };
}

async function openApp({ plugin = true, mock = {}, check = true } = {}) {
  const page = await (await browser.createBrowserContext()).newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message)); page.errs = errs;
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await page.evaluateOnNewDocument(mockBridge, plugin, mock);
  await (await page.createCDPSession()).send('Network.setBypassServiceWorker', { bypass: true });
  await page.setRequestInterception(true);
  page.navigations = [];
  page.on('request', (r) => {
    const u = r.url();
    if (u.startsWith('https://geek4945-creator.github.io/')) return r.respond({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ build: 103, version: '1.0.103', sha: 'abc', date: '' }) });
    if (u.startsWith('https://github.com/')) { page.navigations.push(u); return r.respond({ status: 204, body: '' }); }
    if (u.endsWith('/js/version.js')) return r.respond({ status: 200, contentType: 'text/javascript', body: "export const BUILD = 102;\nexport const VERSION = '1.0.102';\nexport const SHA = 'test';\n" });   // the installed APK is 1.0.102
    r.continue();
  });
  await page.goto(base + 'index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#btn-settings'); await sleep(300);
  if (check) { await page.click('#btn-settings'); await page.waitForSelector('#btn-update'); await page.click('#btn-update'); }
  return page;
}
const banner = (p) => p.$eval('#update-panel', (e) => (e.hidden ? '[hidden] ' : '') + e.textContent).catch(() => '');
const calls = (p, m) => p.evaluate((m) => window.__calls.filter((c) => c.method === m), m);
const waitBanner = (p, re, timeout = 8000) => p.waitForFunction((src) => { const b = document.getElementById('update-panel'); return b && !b.hidden && new RegExp(src).test(b.textContent); }, { timeout }, re.source).catch(async () => { throw new Error('banner never matched ' + re + ': ' + await banner(p)); });

try {
  const p0 = await openApp({ check: false });
  await step('launch with a newer build available: NO prompt on the main screen (no automatic check), no download', async () => {
    await sleep(4000); const r = await p0.evaluate(() => ({ visible: !!document.querySelector('#update-panel:not([hidden])'), inDom: !!document.getElementById('update-panel'), text: document.body.innerText }));
    assert(!r.inDom && !r.visible && !/New app version|Update now|Update available/.test(r.text), JSON.stringify(r).slice(0, 300));
    assert((await calls(p0, 'download')).length === 0, 'no download');
  }); await p0.close();
  const page = await openApp({ mock: { allowed: false, steps: 25, stepMs: 80 } });
  await step('Settings → Check for updates: a newer build shows "Update now" (not "Download APK") inside Settings', async () => {
    await waitBanner(page, /New app version 1\.0\.103.*Update now/, 15000); assert(!/Download APK/.test(await banner(page)));
    assert(await page.$eval('#update-panel', (e) => !!e.closest('#settings')), 'panel is inside the Settings dialog');
  });
  await step('Settings → Check for updates says "tap Update now"', async () => {
    await page.waitForFunction(() => /tap Update now/.test(document.getElementById('toast').textContent), { timeout: 8000 });
  });
  await step('Update now downloads inside the app: percent + MB + progress bar + Cancel; the URL is the latest release APK', async () => {
    await page.click('#update-go'); await waitBanner(page, /Downloading update… [1-9]\d?% · [\d.]+ \/ 4\.1 MB/);
    const v = await page.$eval('#update-progress', (e) => e.value); assert(v > 0 && v < 100, 'bar ' + v); assert(await page.$('#update-cancel'), 'cancel button');
    const d = await calls(page, 'download'); assert(d.length === 1 && d[0].opts.url === APK_URL, JSON.stringify(d));
    await page.screenshot({ path: 'tests/out/appupdate-progress.png' }); return (await banner(page)).slice(0, 60);
  });
  await step('Cancel stops the download and offers Update now again; nothing is installed', async () => {
    await page.click('#update-cancel'); await waitBanner(page, /cancelled.*Update now/);
    assert((await calls(page, 'cancel')).length === 1, 'cancel call'); assert((await calls(page, 'install')).length === 0, 'no install');
  });
  await step('retry → verified download → "Install unknown apps" not allowed: one-line explanation + Open settings', async () => {
    await page.evaluate(() => { window.__mock.steps = 5; window.__mock.stepMs = 40; });
    await page.click('#update-go'); await waitBanner(page, /Install unknown apps.*Open settings/);
    assert((await calls(page, 'install')).length === 0, 'must not install without permission');
    await page.screenshot({ path: 'tests/out/appupdate-permission.png' });
  });
  await step('Open settings → user allows it and comes back → the installer opens with the downloaded file (once)', async () => {
    await page.evaluate(() => { window.__mock.grantInSettings = true; });
    await page.click('#update-go'); await waitBanner(page, /Installing version 1\.0\.103.*confirm/);
    assert((await calls(page, 'openInstallSettings')).length === 1, 'settings opened');
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); await sleep(300);
    const ins = await calls(page, 'install'); assert(ins.length === 1 && /cache\/updates\/RetroPocket-update-1\.apk$/.test(ins[0].opts.path), JSON.stringify(ins));
    assert(page.navigations.length === 0, 'no browser download: ' + page.navigations);
  });
  await step('no JS errors', async () => { assert(!page.errs.length, page.errs.join(' | ')); }); await page.close();

  const p2 = await openApp({ mock: { allowed: false, steps: 3, stepMs: 30 } });
  await step('permission granted OUTSIDE our button (Android prompt / settings), then the app becomes visible again → install resumes', async () => {
    await waitBanner(p2, /Update now/, 15000); await p2.click('#update-go'); await waitBanner(p2, /Install unknown apps/);
    await p2.evaluate(() => { window.__mock.allowed = true; document.dispatchEvent(new Event('visibilitychange')); });
    await waitBanner(p2, /Installing version/); assert((await calls(p2, 'install')).length === 1);
  }); await p2.close();

  const p3 = await openApp({ mock: { steps: 2, stepMs: 30, downloadError: 'WRONG_SIGNER' } });
  await step('signature / version check failure: error shown, never installed, no install button', async () => {
    await waitBanner(p3, /Update now/, 15000); await p3.click('#update-go'); await waitBanner(p3, /Update not installed: .*different key/);
    assert(await p3.$eval('#update-panel', (e) => e.classList.contains('error')), 'error style'); assert(!(await p3.$('#update-go')), 'no action button');
    assert((await calls(p3, 'install')).length === 0, 'install called!'); assert(p3.navigations.length === 0, 'no fallback for a rejected file');
  }); await p3.close();

  const p4 = await openApp({ mock: { steps: 2, stepMs: 30, downloadError: 'NETWORK' } });
  await step('download failure falls back to the browser download link (the old behaviour)', async () => {
    await waitBanner(p4, /Update now/, 15000); await p4.click('#update-go'); await waitBanner(p4, /In-app download failed.*Download APK/);
    await p4.click('#update-go'); await sleep(500); assert(p4.navigations.includes(APK_URL), JSON.stringify(p4.navigations));
  }); await p4.close();

  const p5 = await openApp({ mock: { installError: 'NO_INSTALLER', steps: 2, stepMs: 30 } });
  await step('installer cannot be opened → error + browser download fallback', async () => {
    await waitBanner(p5, /Update now/, 15000); await p5.click('#update-go'); await waitBanner(p5, /Could not open the installer.*Download APK/);
  }); await p5.close();

  const p6 = await openApp({ plugin: false });
  await step('older APK without the plugin: "Download APK" opens the release link in the browser', async () => {
    await waitBanner(p6, /New app version 1\.0\.103.*Download APK/, 15000); await p6.click('#update-go'); await sleep(500);
    assert(p6.navigations.includes(APK_URL), JSON.stringify(p6.navigations)); assert(!(await p6.evaluate(() => window.__calls.length)), 'no native calls');
  }); await p6.close();

  const p7 = await openApp({ check: false, mock: { pending: { path: '/data/user/0/com.retropocket.app/cache/updates/RetroPocket-update-9.apk', versionCode: 1103, versionName: '1.0.103-abc' } } });
  await step('start-up: stale downloads are cleaned (pending() called); a waiting verified download is offered in Settings (dot on ⚙︎, no banner) → Install now', async () => {
    await sleep(800); assert(await p7.$eval('#btn-settings', (e) => e.classList.contains('has-update')), 'dot on Settings'); assert(!(await p7.$('body > #update-panel')), 'no banner');
    await p7.click('#btn-settings'); await waitBanner(p7, /Update 1\.0\.103-abc is downloaded.*Install now/);
    await p7.click('#btn-update'); await sleep(1500); await waitBanner(p7, /is downloaded.*Install now/);   // Check for updates must not offer a second download
    assert((await calls(p7, 'download')).length === 0, 'no re-download');
    assert((await calls(p7, 'pending')).length >= 1, 'pending/cleanup called');
    await p7.click('#update-go'); await waitBanner(p7, /Installing version/);
    assert((await calls(p7, 'install'))[0].opts.path.endsWith('RetroPocket-update-9.apk'));
  }); await p7.close();
} finally { await browser.close(); srv.kill(); }
console.log(failed ? `${failed}/${total} FAILED` : `${total}/${total} passed`);
process.exit(failed ? 1 : 0);

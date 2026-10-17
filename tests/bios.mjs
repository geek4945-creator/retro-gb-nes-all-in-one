// BIOS dialog: system dropdown, per-file status, open-file downloads (mocked fetch: corrupt / 404 / slow stream / real), IndexedDB storage,
// legal notes + docs links for copyrighted-only systems, and delivery of a downloaded BIOS into the emulator file system.
import puppeteer from 'puppeteer-core';
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const PORT = Number(process.env.PORT || 18000 + Math.floor(Math.random() * 20000)), base = process.env.BASE_URL || `http://localhost:${PORT}/`;
mkdirSync('tests/fixtures/systems', { recursive: true }); mkdirSync('tests/out', { recursive: true });
execFileSync('python3', ['scripts/make-system-stubs.py', 'tests/fixtures/systems'], { stdio: 'ignore' });
const FX = 'tests/fixtures/systems/';
const srv = process.env.BASE_URL ? null : spawn('python3', ['-m', 'http.server', String(PORT), '--directory', 'www'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const step = async (n, f) => { try { const v = await f(); console.log('PASS', n, v ?? ''); } catch (e) { failed++; console.log('FAIL', n, '->', e.message); } };
const assert = (c, m) => { if (!c) throw new Error(m || 'assertion failed'); };
const GBA_MD5 = createHash('md5').update(readFileSync('www/bios-open/gba_bios.bin')).digest('hex');
await sleep(800);
const browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: 'new', protocolTimeout: 300000, timeout: 120000, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  // mocked fetch for bios-open/*: window.__mock = 'real' | 'corrupt' | '404' | 'slow' (real bytes streamed in 4 delayed chunks) | 'truncated'
  await page.evaluateOnNewDocument(() => {
    window.__mock = 'real'; window.__fetched = [];
    const real = window.fetch.bind(window);
    window.fetch = async (url, opts) => {
      const u = String(url); if (!u.includes('bios-open/')) return real(url, opts);
      window.__fetched.push(u);
      if (window.__mock === '404') return new Response('nope', { status: 404 });
      const r = await real(url, opts); const bytes = new Uint8Array(await r.arrayBuffer());
      if (window.__mock === 'corrupt') { bytes[10] ^= 0xff; return new Response(bytes, { status: 200 }); }
      if (window.__mock === 'truncated') return new Response(bytes.slice(0, bytes.length - 5), { status: 200 });
      if (window.__mock === 'slow') {
        const q = Math.ceil(bytes.length / 4); let i = 0;
        return new Response(new ReadableStream({ async pull(c) { if (i >= bytes.length) return c.close(); await new Promise((x) => setTimeout(x, 250)); c.enqueue(bytes.slice(i, i + q)); i += q; } }), { status: 200 });
      }
      return new Response(bytes, { status: 200 });
    };
  });
  await page.goto(base + 'index.html', { waitUntil: 'networkidle0' });
  const openDlg = async () => { await page.click('#btn-settings'); await page.waitForSelector('#settings[open]'); await page.click('#btn-bios'); await page.waitForSelector('#bios[open] #bios-system'); };
  const choose = async (k) => { await page.select('#bios-system', k); await page.waitForFunction((k) => document.querySelector('#bios-system').value === k && document.querySelector('#bios .bios-head'), {}, k); await sleep(150); };
  const text = () => page.$eval('#bios', (d) => d.innerText);
  const stored = () => page.evaluate(async () => (await (await import('./js/db.js')).allBios()).map((b) => ({ id: b.id, size: b.size, open: !!b.open, md5: b.md5 })));
  const clickBtn = (needle) => page.evaluate((n) => { const b = [...document.querySelectorAll('#bios button')].find((x) => x.textContent.includes(n) && !x.disabled); if (b) b.click(); return !!b; }, needle);
  await openDlg();

  await step('dropdown lists every BIOS system, grouped, with a status each', async () => {
    const o = await page.$$eval('#bios-system option', (x) => x.map((e) => e.textContent));
    const g = await page.$$eval('#bios-system optgroup', (x) => x.map((e) => e.label));
    assert(o.length === 18, 'systems: ' + o.length + ' ' + o.join('|'));
    for (const want of ['Game Boy Advance', 'PlayStation', 'Sega Saturn', 'Neo Geo', 'Commodore Amiga', '3DO', 'Philips CD-i', 'Nintendo DS', 'Atari 5200']) assert(o.some((t) => t.startsWith(want)), 'missing ' + want);
    assert(o.every((t) => t.includes(' — ')), 'every entry carries a status: ' + o[0]);
    assert(g.includes('Nintendo') && g.includes('Sony') && g.includes('Other'), g.join());
    return o.length + ' systems in ' + g.length + ' groups';
  });

  await step('GBA panel: open file offered with licence + source, level, md5, built-in note, libretro docs link', async () => {
    await choose('gba'); const t = await text();
    assert(/gba_bios\.bin/.test(t) && /OPTIONAL/i.test(t) && /Missing/.test(t), t.slice(0, 400));
    assert(t.includes('a860e8c0b6d573d191e4ec7db1b1e4f6'), 'official md5 shown');
    assert(/Download open files \(1\)/.test(t), 'download button');
    const links = await page.$$eval('#bios a', (a) => a.map((x) => x.getAttribute('href')));
    assert(links.includes('https://docs.libretro.com/library/mgba/'), links.join());
    assert(links.includes('https://github.com/Cult-of-GBA/BIOS') && links.some((l) => l.endsWith('Cult-of-GBA-BIOS.MIT.txt')), links.join());
    assert(await page.$$eval('#bios a', (a) => a.every((x) => x.target === '_blank' && /noopener/.test(x.rel))));
    assert(/built-in open BIOS replacement/.test(t), 'built-in note');
    await page.screenshot({ path: 'tests/out/bios-gba.png' });
  });

  await step('PlayStation panel: copyrighted -> no download, “from your own console” note with exact names + md5, upload + docs link', async () => {
    await choose('psx'); const t = await text();
    assert(!/Download open files/.test(t), 'must not offer a download');
    assert(/Must come from your own console/.test(t) && t.includes('scph5501.bin (md5 490f666e1afb15b7362b406ed1cea246)'), t.slice(0, 900));
    assert(/RECOMMENDED/i.test(t) && /Upload BIOS/.test(t));
    assert(await page.$eval('#bios', (d) => !!d.querySelector('a[href="https://docs.libretro.com/library/pcsx_rearmed/"]')), 'docs link');
    await page.screenshot({ path: 'tests/out/bios-psx.png' });
  });

  await step('required level shown for Sega CD / Neo Geo; Neo Geo explains shared arcade BIOS', async () => {
    await choose('scd'); assert(/REQUIRED/i.test(await text()));
    await choose('neogeo'); const t = await text(); assert(/REQUIRED/i.test(t) && /Arcade/.test(t) && t.includes('neogeo.zip'));
  });

  await step('no commercial BIOS is downloadable: only the 3 declared open files exist, and the download list is exactly those', async () => {
    const list = await page.evaluate(async () => (await import('./js/biosdata.js')).OPEN_FILES.map((o) => o.name + ':' + o.license));
    assert(list.length === 3 && list.every((x) => /MIT/.test(x)), list.join());
  });

  await step('corrupt download is rejected (md5) and NOT stored', async () => {
    await choose('gba'); await page.evaluate(() => (window.__mock = 'corrupt'));
    assert(await clickBtn('Download open files'));
    await page.waitForFunction(() => /checksum mismatch/.test(document.querySelector('#bios .bios-msg').textContent), { timeout: 8000 });
    assert((await stored()).length === 0, JSON.stringify(await stored()));
  });
  await step('truncated download is rejected (size) and 404 shows an HTTP error', async () => {
    await page.evaluate(() => (window.__mock = 'truncated')); assert(await clickBtn('Download open files'));
    await page.waitForFunction(() => /size \d+ B, expected 16384 B/.test(document.querySelector('#bios .bios-msg').textContent), { timeout: 8000 });
    await page.evaluate(() => (window.__mock = '404')); assert(await clickBtn('Download open files'));
    await page.waitForFunction(() => /HTTP 404/.test(document.querySelector('#bios .bios-msg').textContent), { timeout: 8000 });
    assert((await stored()).length === 0);
  });
  await step('good download shows progress, verifies, stores in IndexedDB and flips the row to installed', async () => {
    await page.evaluate(() => (window.__mock = 'slow')); assert(await clickBtn('Download open files'));
    await page.waitForFunction(() => { const p = document.querySelector('#bios progress'); return p && !p.hidden && p.value > 0 && p.value < 1; }, { timeout: 8000 });
    assert(await page.$$eval('#bios button.dl', (b) => b.every((x) => x.disabled)), 'buttons disabled while downloading');
    await page.waitForFunction(() => /Installed gba_bios\.bin/.test(document.querySelector('#bios .bios-msg').textContent), { timeout: 15000 });
    const s = await stored(); assert(s.length === 1 && s[0].id === 'gba/gba_bios.bin' && s[0].size === 16384 && s[0].open && s[0].md5 === GBA_MD5, JSON.stringify(s));
    const t = await text(); assert(/Installed · 16 KB/.test(t) && /open-source replacement/.test(t) && /Download again/.test(t), t.slice(0, 500));
    assert(/✓ 1 installed/.test(await page.$eval('#bios-system option:checked', (o) => o.textContent)), 'dropdown status updated');
    await page.screenshot({ path: 'tests/out/bios-gba-installed.png' });
  });
  await step('“Download all open files” fetches the rest (GB + GBC boot ROMs)', async () => {
    await page.evaluate(() => (window.__mock = 'real')); assert(await clickBtn('Download all open files'));
    await page.waitForFunction(() => /Installed gba_bios\.bin, gb_bios\.bin, gbc_bios\.bin/.test(document.querySelector('#bios .bios-msg').textContent), { timeout: 15000 });
    const ids = (await stored()).map((x) => x.id).sort(); assert(ids.join() === 'gb/gb_bios.bin,gba/gba_bios.bin,gbc/gbc_bios.bin', ids.join());
    assert(/Game Boy — ✓ 1 installed/.test(await page.$$eval('#bios-system option', (o) => o.map((x) => x.textContent).join('\n'))));
  });
  await step('uploading a file whose md5 differs is flagged; Remove deletes it', async () => {
    await choose('lynx');
    const [chooser] = await Promise.all([page.waitForFileChooser(), clickBtn('Upload')]);
    await chooser.accept(['tests/fixtures/systems/lynx.lnx']); await sleep(800);
    const t = await text(); assert(/lynxboot\.img|not a name this system looks for/.test(t), t.slice(0, 300));
    const s = (await stored()).find((x) => x.id.startsWith('lynx/')); assert(s, 'stored under lynx');
    assert(await clickBtn('Remove')); await sleep(500);
    assert(!(await stored()).some((x) => x.id.startsWith('lynx/')), 'removed');
  });
  await step('a stored file with the right name but different md5 says so', async () => {
    await page.evaluate(async () => { const db = await import('./js/db.js'); await db.putBios({ id: 'lynx/lynxboot.img', system: 'lynx', name: 'lynxboot.img', size: 512, data: new Uint8Array(512).buffer, time: 1 }); });
    await page.evaluate(() => { document.querySelector('#bios .row.ghost').click(); }); await openDlg(); await choose('lynx');
    const t = await text(); assert(/Installed · 512 B · md5 differs/.test(t), t.slice(0, 600));
    assert(await clickBtn('Remove'));
  });

  await step('downloaded GBA BIOS reaches the emulator file system byte-for-byte (mGBA sees /gba_bios.bin)', async () => {
    await page.evaluate(async (b64) => {
      const db = await import('./js/db.js'); const d = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      await db.putRom({ id: 'gbaT', file: 'gba.gba', title: 'gba', system: 'gba', core: 'mgba', size: d.length, added: 1, lastPlayed: 0, data: d.buffer });
    }, readFileSync(FX + 'gba.gba').toString('base64'));
    await page.goto(`${base}player.html?id=gbaT`); await page.waitForSelector('.ejs_start_button', { visible: true, timeout: 90000 });
    await page.click('.ejs_start_button'); await page.waitForFunction(() => window.EJS_emulator && window.EJS_emulator.started, { timeout: 90000 });
    const r = await page.evaluate(() => { const FS = window.EJS_emulator.gameManager.FS; const a = FS.analyzePath('/gba_bios.bin'); return { exists: a.exists, bytes: a.exists ? [...FS.readFile('/gba_bios.bin')] : [] }; });
    assert(r.exists && r.bytes.length === 16384, JSON.stringify({ e: r.exists, n: r.bytes.length }));
    const md5 = createHash('md5').update(Buffer.from(r.bytes)).digest('hex'); assert(md5 === GBA_MD5, md5);
  });

  await step('Amiga with no Kickstart stored selects the built-in AROS replacement (and not when one is stored)', async () => {
    await page.goto(base + 'index.html', { waitUntil: 'networkidle0' });
    const put = (id) => page.evaluate(async (b64, id) => { const db = await import('./js/db.js'); const d = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)); await db.putRom({ id, file: 'amiga.adf', title: id, system: 'amiga', core: 'puae', size: d.length, added: 1, lastPlayed: 0, data: d.buffer }); }, readFileSync(FX + 'amiga.adf').toString('base64'), id);
    await put('am1');
    await page.goto(`${base}player.html?id=am1`); await page.waitForSelector('.ejs_start_button', { visible: true, timeout: 90000 });
    let o = await page.evaluate(() => ({ aros: window.__rpAros, opt: window.EJS_defaultOptions.puae_kickstart }));
    assert(o.aros === true && o.opt === 'aros', JSON.stringify(o));
    await page.click('.ejs_start_button'); await page.waitForFunction(() => window.EJS_emulator && window.EJS_emulator.started, { timeout: 90000 });
    assert(await page.evaluate(() => window.EJS_emulator.getSettingValue('puae_kickstart')) === 'aros', 'core option puae_kickstart not applied');
    await page.goto(base + 'index.html', { waitUntil: 'networkidle0' });
    await page.evaluate(async () => { const db = await import('./js/db.js'); await db.putBios({ id: 'amiga/kick34005.A500', system: 'amiga', name: 'kick34005.A500', size: 1024, data: new Uint8Array(1024).buffer, time: 1 }); });
    await page.goto(`${base}player.html?id=am1`); await page.waitForSelector('.ejs_start_button', { visible: true, timeout: 90000 });
    o = await page.evaluate(() => ({ aros: window.__rpAros, opt: window.EJS_defaultOptions.puae_kickstart }));
    assert(o.aros === false && o.opt === undefined, JSON.stringify(o));
  });
  assert(errs.filter((e) => !/Abort|abort/.test(e)).length === 0, 'page errors: ' + errs.join(' | '));
} catch (e) { failed++; console.log('FAIL (harness)', e.stack || e.message); }
await browser.close(); if (srv) srv.kill();
console.log(failed ? `${failed} failure(s)` : 'bios: all checks passed'); process.exit(failed ? 1 : 0);

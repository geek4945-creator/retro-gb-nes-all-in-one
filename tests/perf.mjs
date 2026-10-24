// Settings → Performance & device: device info, benchmark, Auto tier + reasons, Fast / Balanced / Best presets mapped to real
// EmulatorJS 4.2.3 core options, per-game override precedence, reconciling EmulatorJS' saved per-game settings, game start.
import puppeteer from 'puppeteer-core';
import { execFileSync, spawn } from 'node:child_process';
import { readFileSync, mkdirSync } from 'node:fs';
mkdirSync('tests/fixtures', { recursive: true }); mkdirSync('tests/out', { recursive: true });
execFileSync('python3', ['scripts/make-test-rom.py', 'tests/fixtures/nes-test.nes']);
const PORT = 18000 + Math.floor(Math.random() * 20000), base = `http://localhost:${PORT}/`;
const srv = spawn('python3', ['-m', 'http.server', String(PORT), '--directory', 'www'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0, total = 0;
const step = async (n, f) => { total++; try { const v = await f(); console.log('PASS', n, v ?? ''); } catch (e) { failed++; console.log('FAIL', n, '->', e.message); } };
const assert = (c, m) => { if (!c) throw new Error(m || 'assertion failed'); };
const rom = [...readFileSync('tests/fixtures/nes-test.nes')];
await sleep(800);
const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', protocolTimeout: 240000, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage(); const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await page.goto(base + 'index.html', { waitUntil: 'networkidle0' });
  const P = (fn, ...a) => page.evaluate(async (src, a) => { const m = await import('./js/perf.js'); return (0, eval)('(' + src + ')')(m, ...a); }, fn.toString(), a);

  await step('Auto: entry-level phone → Fast, flagship → Best, desktop GPU → Best, iPhone → Balanced; always explains why', async () => {
    const r = await P((m) => {
      const base = { webgl: true, webgl2: true, screen: {} };
      return {
        weak: m.autoTier({ ...base, platform: 'android-app', cores: 8, renderer: 'Mali-G52', native: { totalRamMB: 3000, lowRam: false } }),
        lowram: m.autoTier({ ...base, platform: 'android-app', cores: 4, renderer: 'Adreno (TM) 610', native: { totalRamMB: 2000, lowRam: true } }),
        flag: m.autoTier({ ...base, platform: 'android-app', cores: 8, renderer: 'Adreno (TM) 740', native: { totalRamMB: 12000 } }),
        mid: m.autoTier({ ...base, platform: 'android-app', cores: 8, renderer: 'Mali-G68', native: { totalRamMB: 6000 } }),
        desk: m.autoTier({ ...base, platform: 'desktop', cores: 12, renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060)' }),
        ios: m.autoTier({ ...base, platform: 'ios', cores: 6, renderer: 'Apple GPU' }),
        nogl2: m.autoTier({ ...base, webgl2: false, platform: 'android', cores: 8, renderer: 'Adreno (TM) 740' }),
        benchLow: m.autoTier({ ...base, platform: 'android', cores: 8, renderer: '' }, { score: 150 }),
      };
    });
    const t = Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v.tier]));
    assert(t.weak === 'fast' && t.lowram === 'fast' && t.flag === 'best' && t.mid === 'balanced' && t.desk === 'best' && t.ios === 'balanced' && t.nogl2 === 'fast' && t.benchLow === 'fast', JSON.stringify(t));
    assert(Object.values(r).every((v) => v.reasons.length > 0), 'reasons'); assert(r.ios.reasons.some((x) => /Safari/.test(x)), 'iOS reason'); return JSON.stringify(t);
  });
  await step('presets map to real core option values (N64 / PS1 / PSP) + filter / rewind defaults', async () => {
    const r = await P((m) => ({ f: m.presetOptions('fast'), b: m.presetOptions('balanced'), x: m.presetOptions('best'), filt: ['fast', 'balanced', 'best'].map((p) => [m.presetFilter(p, 'snes'), m.presetFilter(p, 'gba'), m.presetFilter(p, 'n64')]), rew: ['fast', 'balanced', 'best'].map((p) => [m.presetRewind(p, 'nes'), m.presetRewind(p, 'n64')]) }));
    assert(r.f['mupen64plus-43screensize'] === '320x240' && r.f['mupen64plus-FrameDuping'] === 'True' && r.f.pcsx_rearmed_frameskip_type === 'auto' && r.f.ppsspp_auto_frameskip === 'enabled', JSON.stringify(r.f));
    assert(r.b['mupen64plus-43screensize'] === '640x480' && r.b.pcsx_rearmed_frameskip_type === 'disabled' && r.b.ppsspp_internal_resolution === '480x272', JSON.stringify(r.b));
    assert(r.x['mupen64plus-43screensize'] === '960x720' && r.x.beetle_psx_hw_internal_resolution === '2x' && r.x.ppsspp_internal_resolution === '960x544', JSON.stringify(r.x));
    assert(r.f.vsync === 'enabled' && r.x.vsync === 'enabled', 'vsync');
    assert(JSON.stringify(r.filt) === '[["off","off","off"],["off","off","off"],["crt","lcd","off"]]', JSON.stringify(r.filt)); assert(JSON.stringify(r.rew) === '[[false,false],[true,false],[true,false]]', JSON.stringify(r.rew));
    return 'ok';
  });
  await step('precedence: per-game choice > Settings choice > Auto', async () => {
    const r = await P((m) => {
      localStorage.setItem('rp.perf', JSON.stringify({ mode: 'auto', auto: { tier: 'fast', reasons: ['x'] } })); const a = m.effectivePreset('g1');
      localStorage.setItem('rp.perf', JSON.stringify({ mode: 'best', auto: { tier: 'fast', reasons: ['x'] } })); const b = m.effectivePreset('g1');
      m.setGamePreset('g1', 'balanced'); const c = m.effectivePreset('g1'), d = m.effectivePreset('g2');
      m.setGamePreset('g1', ''); const e = m.effectivePreset('g1');
      localStorage.removeItem('rp.perf'); return [a, b, c, d, e].map((x) => x.preset + '/' + x.source);
    });
    assert(r.join() === 'fast/auto,best/global,balanced/game,best/global,best/global', r.join()); return r.join();
  });
  await step('EmulatorJS saved per-game settings: our old values are updated, values you changed in ⚙ stay', async () => {
    const r = await P((m) => {
      localStorage.removeItem('rp.perf.applied');
      const k = 'ejs-g9-n64-Mario-settings', put = (s) => localStorage.setItem(k, JSON.stringify({ settings: s, controlSettings: {} })), get = () => JSON.parse(localStorage.getItem(k)).settings;
      put({ 'mupen64plus-43screensize': '640x480', 'mupen64plus-FrameDuping': 'False', shader: 'disabled' });      // core defaults saved by EJS before we existed
      const o1 = m.presetOptions('fast'); m.reconcileSaved('g9', 'Mario', o1); const s1 = get();
      const o2 = m.presetOptions('best'); m.reconcileSaved('g9', 'Mario', o2); const s2 = get();
      const s = get(); s['mupen64plus-43screensize'] = '640x480'; put(s);                                          // you change it for this game
      const o3 = m.presetOptions('fast'); m.reconcileSaved('g9', 'Mario', o3); const s3 = get();
      return { s1: s1['mupen64plus-43screensize'] + s1['mupen64plus-FrameDuping'], s2: s2['mupen64plus-43screensize'] + s2['mupen64plus-FrameDuping'], s3: s3['mupen64plus-43screensize'] + s3['mupen64plus-FrameDuping'], o3has: 'mupen64plus-43screensize' in o3, shader: s3.shader };
    });
    assert(r.s1 === '320x240True' && r.s2 === '960x720False' && r.s3 === '640x480True' && !r.o3has && r.shader === 'disabled', JSON.stringify(r)); return JSON.stringify(r);
  });
  await step('Settings → ⚡ Performance & device shows device info, Auto pick + reasons, modes; Back sits in the top bar', async () => {
    await page.reload({ waitUntil: 'networkidle0' });
    await page.click('#btn-settings'); await page.waitForSelector('#btn-perf', { visible: true }); await page.$eval('#btn-perf', (e) => e.click());
    await page.waitForSelector('#perf-info', { timeout: 10000 });
    const r = await page.evaluate(() => ({ info: [...document.querySelectorAll('#perf-info .perf-kv')].map((e) => e.textContent), auto: document.getElementById('perf-auto').textContent, modes: [...document.querySelectorAll('#perf-modes input')].map((e) => e.value + (e.checked ? '*' : '')), back: (() => { const b = document.getElementById('perf-back'); return { inTop: !!b.closest('.sheet-top'), top: b.getBoundingClientRect().top }; })() }));
    for (const k of ['CPU cores', 'GPU', 'WebGL2', 'Max texture', 'Screen', 'Refresh rate']) assert(r.info.some((t) => t.startsWith(k)), 'missing ' + k + ' ' + r.info);
    assert(/Auto picks: .+ because: .+/.test(r.auto), r.auto); assert(r.modes.join() === 'auto*,fast,balanced,best', r.modes.join()); assert(r.back.inTop && r.back.top < 120, JSON.stringify(r.back));
    await page.screenshot({ path: 'tests/out/perf-settings.png', fullPage: false }); return r.auto;
  });
  await step('benchmark gives a score and feeds Auto; choosing Best is saved', async () => {
    await page.$eval('#perf-bench', (e) => e.click()); await page.waitForFunction(() => /Score: \d+/.test(document.getElementById('perf-bench-out').textContent), { timeout: 15000 });
    await page.$eval('#perf-mode-best', (e) => e.click()); await sleep(200);
    const p = await page.evaluate(() => JSON.parse(localStorage.getItem('rp.perf')));
    assert(p.mode === 'best' && p.bench && p.bench.score > 0 && p.auto && p.auto.reasons.some((x) => /benchmark/.test(x)), JSON.stringify(p)); return `score ${p.bench.score}, auto ${p.auto.tier}`;
  });
  await step('device info rows from the Android plugin (model, chipset, Android, RAM) when present', async () => {
    const rows = await page.evaluate(async () => { const { infoRows } = await import('./js/perfui.js'); return infoRows({ cores: 8, webgl2: true, webgl: true, renderer: 'Adreno (TM) 740', screen: { w: 1080, h: 2400, cssW: 412, cssH: 915, dpr: 2.625 }, refresh: 120, native: { manufacturer: 'samsung', model: 'SM-S911B', soc: 'SM8550', socManufacturer: 'QTI', android: '15', sdk: 35, totalRamMB: 7680, memoryClassMB: 256 } }).map((r) => r.join(': ')); });
    for (const re of [/Phone: samsung SM-S911B/, /Chipset: QTI SM8550/, /Android: 15 \(API 35\)/, /RAM: 7\.5 GB · app limit 256 MB/, /Refresh rate: ≈ 120 Hz/]) assert(rows.some((r) => re.test(r)), re + ' ' + rows);
    return rows.slice(0, 4).join(' | ');
  });
  await page.evaluate(async (b) => { const db = await import('./js/db.js'); await db.putRom({ id: 'p1', file: 'nes-test.nes', title: 'NES Test', system: 'nes', core: 'nestopia', size: b.length, added: 1, lastPlayed: 0, data: new Uint8Array(b).buffer }); }, rom);
  await step('game sheet has a Graphics select (Same as Settings / Fast / Balanced / Best) saved per game', async () => {
    await page.goto(base + 'index.html', { waitUntil: 'networkidle0' }); await page.waitForSelector('#library .card .more');
    await page.$eval('#library .card .more', (e) => e.click()); await page.waitForSelector('#sheet-gfx', { visible: true });
    const opts = await page.$$eval('#sheet-gfx option', (a) => a.map((o) => o.textContent));
    await page.select('#sheet-gfx', 'fast'); await sleep(200);
    const g = await page.evaluate(() => JSON.parse(localStorage.getItem('rp.perf.games')));
    assert(/Same as Settings \(Best looking\)/.test(opts[0]) && opts.length === 4 && g.p1 === 'fast', JSON.stringify({ opts, g })); return opts.join(' / ');
  });
  const boot = async () => {
    await page.goto(`${base}player.html?id=p1`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.ejs_start_button', { visible: true, timeout: 120000 }); await page.tap('.ejs_start_button');
    await page.waitForFunction(() => window.EJS_emulator && EJS_emulator.started, { timeout: 120000 }); await sleep(1000);
  };
  await step('game start applies the per-game preset (Fast): core options in defaults, no rewind, no filter', async () => {
    await boot();
    const r = await page.evaluate(() => ({ p: window.__rpPreset, d: window.EJS_defaultOptions, rew: EJS_emulator.rewindEnabled }));
    assert(r.p.preset === 'fast' && r.p.source === 'game' && r.d['mupen64plus-43screensize'] === '320x240' && r.d.pcsx_rearmed_frameskip_type === 'auto' && !r.rew, JSON.stringify({ p: r.p.preset, s: r.p.source, rew: r.rew })); return 'ok';
  });
  await step('Settings Best (no per-game choice): CRT filter on a 2D system, rewind on', async () => {
    await page.evaluate(() => localStorage.setItem('rp.perf.games', '{}')); await boot();
    const r = await page.evaluate(() => { let sh = null; try { sh = EJS_emulator.Module.FS.readFile('/shader/shader.glslp', { encoding: 'utf8' }); } catch {} return { p: window.__rpPreset.preset, s: window.__rpPreset.source, rew: EJS_emulator.rewindEnabled, sh }; });
    assert(r.p === 'best' && r.s === 'global' && r.rew && /zfast/.test(r.sh || ''), JSON.stringify(r)); return 'ok';
  });
  await step('switching that game to Fast removes the CRT filter the Best preset had put there', async () => {
    await page.evaluate(() => localStorage.setItem('rp.perf.games', JSON.stringify({ p1: 'fast' }))); await boot();
    const sh = await page.evaluate(() => { try { return EJS_emulator.Module.FS.readFile('/shader/shader.glslp', { encoding: 'utf8' }); } catch { return ''; } });
    assert(!/zfast/.test(sh), sh); await page.evaluate(() => localStorage.setItem('rp.perf.games', '{}')); return 'ok';
  });
  await step('Best again, then a filter you picked in ☰ (Off) wins over the preset', async () => {
    await boot(); const on = await page.evaluate(() => { try { return EJS_emulator.Module.FS.readFile('/shader/shader.glslp', { encoding: 'utf8' }); } catch { return ''; } }); assert(/zfast/.test(on), 'best did not re-apply'); return 'ok';
  });
  await step('a filter you picked in ☰ wins over the preset', async () => {
    await page.evaluate(() => localStorage.setItem('rp.shader', JSON.stringify({ nes: 'off' }))); await boot();
    const sh = await page.evaluate(() => { try { return EJS_emulator.Module.FS.readFile('/shader/shader.glslp', { encoding: 'utf8' }); } catch { return ''; } });
    assert(!/zfast/.test(sh), sh); return 'ok';
  });
  await step('no page errors', async () => { assert(!errs.length, errs.join(' | ')); return 'ok'; });
} catch (e) { failed++; console.log('FAIL fatal', e.message); }
await browser.close(); srv.kill();
console.log(`\n${total - failed}/${total} passed`); process.exit(failed ? 1 : 0);

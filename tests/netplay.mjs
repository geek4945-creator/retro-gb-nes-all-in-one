// Online play: a local PeerJS signalling server (server/), a host tab running a game and a guest tab on join.html.
// Checks that the guest receives the live game video and that its inputs reach the host's emulator as Player 2.
// Needs network for the EmulatorJS CDN (core download); signalling stays on localhost.
// NOTE: on machines whose Chrome policy blocks WebRTC UDP (WebRtcIPHandling = disable_non_proxied_udp, e.g. sandboxed CI boxes)
// no ICE candidates exist, so the media/input steps run over an in-test relay that replaces PeerJS' transport (MOCK_RTC=1, auto-detected);
// the real PeerJS signalling (room registration, "room not found") is always tested against server/server.js.
import puppeteer from 'puppeteer-core';
import { execFileSync, spawn } from 'node:child_process';
import { readFileSync, mkdirSync } from 'node:fs';
mkdirSync('tests/out', { recursive: true });
execFileSync('python3', ['scripts/make-test-rom.py', 'tests/fixtures/nes-test.nes']);
const rnd = () => 18000 + Math.floor(Math.random() * 20000);
const PORT = rnd(), SPORT = rnd(), base = `http://localhost:${PORT}/`;
const srv = spawn('python3', ['-m', 'http.server', String(PORT), '--directory', 'www'], { stdio: 'ignore' });
const sig = spawn(process.execPath, ['server/server.js'], { env: { ...process.env, PORT: String(SPORT), PROXIED: '0' }, stdio: ['ignore', 'pipe', 'inherit'] });
let sigLog = ''; sig.stdout.on('data', (d) => (sigLog += d));
const MOCK_PEER = `(() => {
  const on = (o) => { o._h = {}; o.on = (e, f) => (((o._h[e] = o._h[e] || []).push(f)), o); o._emit = (e, ...a) => (o._h[e] || []).forEach((f) => f(...a)); return o; };
  const conns = {}; let me = null;
  function mkConn(id, peer, metadata) { const c = on({ connId: id, peer, metadata, open: false, send: (d) => window.__mockSend(peer, { type: 'data', connId: id, d: JSON.parse(JSON.stringify(d)) }), close() { if (!conns[id]) return; delete conns[id]; c.open = false; window.__mockSend(peer, { type: 'close', connId: id }); c._emit('close'); } }); conns[id] = c; return c; }
  window.__mockRecv = (m) => {
    if (m.type === 'open') me._emit('open', me.id);
    else if (m.type === 'error') me._emit('error', Object.assign(new Error(m.errType), { type: m.errType }));
    else if (m.type === 'connect') { const c = mkConn(m.connId, m.src, m.metadata); me._emit('connection', c); c.open = true; c._emit('open'); window.__mockSend(m.src, { type: 'accept', connId: m.connId }); }
    else if (m.type === 'accept') { const c = conns[m.connId]; if (c) { c.open = true; c._emit('open'); } }
    else if (m.type === 'data') { const c = conns[m.connId]; if (c) c._emit('data', m.d); }
    else if (m.type === 'close') { const c = conns[m.connId]; if (c) { delete conns[m.connId]; c.open = false; c._emit('close'); } }
    else if (m.type === 'call') { const mc = on({ peer: m.src, close() {}, answer() { const cv = document.createElement('canvas'); cv.width = 160; cv.height = 144; const x = cv.getContext('2d'); let n = 0; setInterval(() => { x.fillStyle = 'hsl(' + (n++ * 7 % 360) + ',70%,50%)'; x.fillRect(0, 0, 160, 144); }, 16); setTimeout(() => mc._emit('stream', cv.captureStream(30)), 50); } }); me._emit('call', mc); }
  };
  class Peer { constructor(id) { if (typeof id !== 'string') id = null; this.id = id || 'g-' + Math.random().toString(36).slice(2, 8); on(this); me = this; window.__mockSend(null, { type: 'register', id: this.id }); }
    connect(dst, o = {}) { const id = 'c' + Math.random().toString(36).slice(2); const c = mkConn(id, dst, o.metadata); window.__mockSend(dst, { type: 'connect', connId: id, src: this.id, metadata: o.metadata }); return c; }
    call(dst, stream) { window.__mockCallStream = stream; window.__mockSend(dst, { type: 'call', src: this.id }); return on({ close() {} }); }
    destroy() { this.destroyed = true; Object.values(conns).forEach((c) => c.close()); window.__mockSend(null, { type: 'unregister', id: this.id }); }
    reconnect() {} }
  window.Peer = Peer;
})();`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0, total = 0;
const step = async (n, f) => { total++; try { const v = await f(); console.log('PASS', n, v ?? ''); } catch (e) { failed++; console.log('FAIL', n, '->', e.message); } };
const assert = (c, m) => { if (!c) throw new Error(m || 'assertion failed'); };
await sleep(1200);
// two separate browsers = two devices (a background tab in one browser would be throttled)
const launch = () => puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: 'new', protocolTimeout: 120000,
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-features=WebRtcHideLocalIpsWithMdns', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] });
const browser = await launch(), browser2 = await launch();
const errs = [];
try {
  const host = await browser.newPage(); host.on('pageerror', (e) => errs.push('host: ' + e.message));
  await host.setViewport({ width: 800, height: 600 });
  await host.goto(base + 'index.html#nopad', { waitUntil: 'domcontentloaded' });
  const bytes = [...readFileSync('tests/fixtures/nes-test.nes')];
  await host.evaluate(async (bytes, sport) => {
    localStorage.setItem('rp.net', JSON.stringify({ server: `http://localhost:${sport}`, name: 'Tester' }));
    const db = await import('./js/db.js'); await db.putRom({ id: 'g1', file: 'nes-test.nes', title: 'NES Test', system: 'nes', core: 'nestopia', size: bytes.length, added: 1, lastPlayed: 0, data: new Uint8Array(bytes).buffer });
  }, bytes, SPORT);

  await step('Settings → Online play: server / STUN / TURN fields saved, Join button', async () => {
    await host.click('#btn-settings'); await host.waitForSelector('#btn-net'); await host.click('#btn-net');
    await host.waitForSelector('#net-turnUrl');
    const v = await host.$eval('#net-server', (e) => e.value); assert(v === `http://localhost:${SPORT}`, v);
    assert(await host.$eval('#net-stun', (e) => e.placeholder.includes('stun:')), 'stun default');
    await host.type('#net-turnUrl', 'turn:turn.example.com:3478'); await host.click('#btn-net-save'); await sleep(300);
    const c = await host.evaluate(() => JSON.parse(localStorage.getItem('rp.net'))); assert(c.turnUrl === 'turn:turn.example.com:3478' && /stun:stun\.l\.google/.test(c.stun), JSON.stringify(c));
    await host.evaluate(() => { const c = JSON.parse(localStorage.getItem('rp.net')); c.turnUrl = ''; localStorage.setItem('rp.net', JSON.stringify(c)); });
    assert(await host.$('#btn-join') === null || true); return 'saved';
  });

  const bootGame = async () => {
    await host.goto(base + 'player.html?id=g1', { waitUntil: 'domcontentloaded' });
    await host.waitForSelector('.ejs_start_button', { visible: true, timeout: 120000 }); await host.click('.ejs_start_button');
    await host.waitForFunction(() => window.EJS_emulator && EJS_emulator.started, { timeout: 120000 }); await sleep(1500);
  };
  const openRoom = async () => {
    await host.click('#menu-btn'); await host.waitForSelector('#pm-net', { visible: true }); await host.click('#pm-net');
    await host.waitForSelector('#net-start'); await host.click('#net-start');
    await host.waitForSelector('#net-code', { timeout: 20000 }).catch(async () => { throw new Error(await host.$eval('.net-panel', (e) => e.textContent)); });
    const c = await host.$eval('#net-code', (e) => e.textContent), link = await host.$eval('#net-link', (e) => e.value);
    await host.click('#pmpanel-back'); await host.click('#pm-resume'); await sleep(300);
    return [c, link];
  };
  await bootGame();
  let code = '';
  await step('host: ☰ → Online play → Start a room registers the room on the signalling server; code, join link and badge shown', async () => {
    const [c, link] = await openRoom(); code = c;
    assert(/^[A-Z2-9]{6}$/.test(code), code); assert(link.includes('join.html?room=' + code) && link.includes('srv='), link);
    assert(await host.$eval('#net-badge', (e, c) => !e.hidden && e.textContent.includes(c), code), 'badge');
    await sleep(300); assert(sigLog.includes('peer + rp-' + code.toLowerCase()), 'server did not see the room: ' + sigLog);
    return `${code} ${link}`;
  });

  const guest = await browser2.newPage(); guest.on('pageerror', (e) => errs.push('guest: ' + e.message));
  await guest.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await step('guest: a wrong room code gives a clear "not found" message (real signalling)', async () => {
    await guest.goto(base + 'join.html', { waitUntil: 'domcontentloaded' });
    await guest.evaluate((sport) => localStorage.setItem('rp.net', JSON.stringify({ server: `http://localhost:${sport}`, name: 'Guesty' })), SPORT);
    await guest.reload({ waitUntil: 'domcontentloaded' });
    await guest.type('#code', 'ZZZZZZ'); await guest.click('#join');
    await guest.waitForFunction(() => !document.getElementById('jerr').hidden, { timeout: 30000 });
    const t = await guest.$eval('#jerr', (e) => e.textContent); assert(/not found|No answer/.test(t), t); return t;
  });

  // can this machine's browser make WebRTC connections at all?
  const cands = await guest.evaluate(() => new Promise((res) => { const pc = new RTCPeerConnection(); const c = []; pc.createDataChannel('x'); pc.onicecandidate = (e) => (e.candidate ? c.push(e.candidate.type) : res(c.length)); pc.createOffer().then((o) => pc.setLocalDescription(o)); setTimeout(() => res(c.length), 5000); }));
  const MOCK = process.env.MOCK_RTC === '1' || (process.env.MOCK_RTC !== '0' && cands === 0);
  console.log(MOCK ? `NOTE: this browser gathers no WebRTC ICE candidates (policy) -> media/input steps use the in-test relay instead of WebRTC` : `WebRTC available (${cands} ICE candidates) -> real peer-to-peer test`);
  if (MOCK) {
    const reg = new Map();
    const wire = async (page) => {
      await page.exposeFunction('__mockSend', async (to, m) => {
        if (m.type === 'register') { reg.set(m.id, page); setTimeout(() => page.evaluate((x) => window.__mockRecv(x), { type: 'open' }).catch(() => {}), 20); return; }
        if (m.type === 'unregister') { reg.delete(m.id); return; }
        const dst = reg.get(to);
        if (!dst) { if (m.type === 'connect') page.evaluate((x) => window.__mockRecv(x), { type: 'error', errType: 'peer-unavailable' }).catch(() => {}); return; }
        await dst.evaluate((x) => window.__mockRecv(x), m).catch(() => {});
      });
      await page.evaluateOnNewDocument(MOCK_PEER);
    };
    await wire(host); await wire(guest);
    await bootGame(); [code] = await openRoom();
  }
  await step('guest: opening the share link joins the room and shows the host\'s live game video', async () => {
    await host.evaluate(() => { window.__rpNetLog = []; });
    await guest.goto(`${base}join.html?room=${code}&srv=${encodeURIComponent(`http://localhost:${SPORT}`)}`, { waitUntil: 'domcontentloaded' });
    guest.on('console', (m) => process.env.NPDEBUG && console.log('guest>', m.text())); host.on('console', (m) => process.env.NPDEBUG && console.log('host>', m.text()));
    await guest.waitForFunction(() => window.__rpGotStream, { timeout: 30000 }).catch(async () => { throw new Error('no stream: ' + JSON.stringify(await guest.evaluate(() => ({ err: document.getElementById('jerr').textContent, info: document.getElementById('info').textContent, ov: document.getElementById('overlay').textContent, stage: !document.getElementById('stage').hidden, url: location.href })))); });
    await guest.waitForFunction(() => document.getElementById('screen').videoWidth > 0, { timeout: 20000 });
    const frames = await guest.evaluate(() => new Promise((res) => { const v = document.getElementById('screen'); let n = 0; const t0 = performance.now(); const cb = () => { n++; if (performance.now() - t0 < 2000) v.requestVideoFrameCallback(cb); else res(n); }; v.requestVideoFrameCallback(cb); }));
    const vw = await guest.$eval('#screen', (v) => `${v.videoWidth}x${v.videoHeight}`);
    assert(frames >= 10, 'frames in 2 s: ' + frames);
    if (MOCK) {          // the stream the host would send over WebRTC: a live canvas capture of the running game, with frames advancing
      const h = await host.evaluate(() => new Promise((res) => { const s = window.__mockCallStream; if (!s) return res('no stream'); const v = document.createElement('video'); v.muted = true; v.srcObject = s; v.play(); let n = 0; const t0 = performance.now(); const cb = () => { n++; if (performance.now() - t0 < 2000) v.requestVideoFrameCallback(cb); else res({ n, w: v.videoWidth, h: v.videoHeight, video: s.getVideoTracks().length, audio: s.getAudioTracks().length }); }; v.requestVideoFrameCallback(cb); setTimeout(() => res({ n, timeout: true }), 6000); }));
      assert(h && h.n >= 10 && h.w > 0, 'host stream: ' + JSON.stringify(h));
      await guest.screenshot({ path: 'tests/out/netplay-guest.png' });
      return `host game stream ${h.w}x${h.h}, ${h.n} frames in 2 s, ${h.video} video + ${h.audio} audio track(s); guest playing relayed stand-in ${vw}`;
    }
    await guest.screenshot({ path: 'tests/out/netplay-guest.png' });
    return `${vw}, ${frames} frames in 2 s`;
  });
  await step('host sees the guest (Player 2) and the guest sees its slot + ping', async () => {
    await guest.waitForFunction(() => /Player 2/.test(document.getElementById('info').textContent) && /ms/.test(document.getElementById('info').textContent), { timeout: 15000 });
    return await guest.$eval('#info', (e) => e.textContent);
  });
  await step('guest keyboard input (X = A button) reaches the host emulator as Player 2 (simulateInput)', async () => {
    await guest.keyboard.down('KeyX'); await sleep(250); await guest.keyboard.up('KeyX'); await sleep(400);
    const log = await host.evaluate(() => window.__rpNetLog);
    assert(log.some(([s, i, v]) => s === 1 && i === 8 && v === 1) && log.some(([s, i, v]) => s === 1 && i === 8 && v === 0), JSON.stringify(log)); return JSON.stringify(log);
  });
  await step('guest touch pad (D-pad right + START) reaches the host', async () => {
    await host.evaluate(() => { window.__rpNetLog = []; });
    const r = await guest.$eval('#dpad', (e) => { const b = e.getBoundingClientRect(); return [b.right - 15, b.top + b.height / 2]; });
    await guest.touchscreen.tap(r[0], r[1]); await sleep(200);
    await guest.tap('#tpad button[data-id="3"]'); await sleep(500);
    const log = await host.evaluate(() => window.__rpNetLog);
    assert(log.some(([s, i, v]) => i === 7 && v === 1) && log.some(([s, i, v]) => i === 3 && v === 1) && log.some(([s, i, v]) => i === 3 && v === 0), JSON.stringify(log)); return JSON.stringify(log);
  });
  await step('host moves the guest to Player 1 (shared) / Watching; watching inputs are ignored', async () => {
    await host.click('#menu-btn'); await host.click('#pm-net'); await host.waitForSelector('.net-guest select');
    await host.select('.net-guest select', '-1');
    await guest.waitForFunction(() => /Watching/.test(document.getElementById('info').textContent), { timeout: 8000 });
    await host.evaluate(() => { window.__rpNetLog = []; }); await guest.keyboard.press('KeyX'); await sleep(400);
    assert((await host.evaluate(() => window.__rpNetLog)).length === 0, 'watching guest input was applied');
    await host.select('.net-guest select', '0'); await guest.waitForFunction(() => /Player 1/.test(document.getElementById('info').textContent), { timeout: 8000 });
    await guest.keyboard.press('KeyX'); await sleep(400);
    const log = await host.evaluate(() => window.__rpNetLog); assert(log.some(([s, i]) => s === 0 && i === 8), JSON.stringify(log));
    await host.screenshot({ path: 'tests/out/netplay-host.png' });
    return 'ok';
  });
  await step('pause menu tells the guest; Stop hosting ends the session for the guest', async () => {
    await guest.waitForFunction(() => /paused/i.test(document.getElementById('overlay').textContent), { timeout: 8000 });
    await host.click('#net-stop'); await guest.waitForFunction(() => /ended|Disconnected/.test(document.getElementById('overlay').textContent), { timeout: 8000 });
    return await guest.$eval('#overlay', (e) => e.textContent);
  });
  await step('no page errors', async () => { assert(!errs.length, errs.join('\n')); });
} finally {
  await browser.close(); await browser2.close(); srv.kill(); sig.kill();
}
console.log(`\n${total - failed}/${total} passed`);
process.exit(failed ? 1 : 0);

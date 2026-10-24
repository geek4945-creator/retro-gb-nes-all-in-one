// Settings → ⚡ Performance & device (see perf.js for the logic and the preset → option mapping).
import { loadPerf, savePerf, deviceInfo, autoTier, benchmark, PRESETS, presetOptions, presetFilter } from './perf.js';

const el = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); for (const k of kids) if (k != null) e.append(k); return e; };
const gb = (mb) => (mb / 1024).toFixed(mb >= 10240 ? 0 : 1) + ' GB';

export function infoRows(info) {
  const n = info.native || null, rows = [];
  if (n) {
    rows.push(['Phone', [n.manufacturer, n.model].filter(Boolean).join(' ') || '—']);
    rows.push(['Chipset', n.soc ? [n.socManufacturer, n.soc].filter(Boolean).join(' ') : (n.sdk >= 31 ? 'not reported' : 'needs Android 12+ to report') + (n.hardware ? ` (board: ${n.hardware})` : '')]);
    rows.push(['Android', `${n.android || '?'} (API ${n.sdk || '?'})`]);
    if (n.totalRamMB) rows.push(['RAM', `${gb(n.totalRamMB)}${n.memoryClassMB ? ` · app limit ${n.memoryClassMB} MB${n.largeMemoryClassMB ? ` (large ${n.largeMemoryClassMB} MB)` : ''}` : ''}${n.lowRam ? ' · low-RAM device' : ''}`]);
  }
  rows.push(['CPU cores', info.cores ? String(info.cores) : 'not reported']);
  if (!n || !n.totalRamMB) rows.push(['RAM', info.ramGB ? `≈ ${info.ramGB} GB (browser estimate, capped at 8)` : info.platform === 'ios' ? 'hidden by Safari' : 'not reported by this browser']);
  rows.push(['GPU', info.renderer ? info.renderer.replace(/^ANGLE \((.*)\)$/, '$1') : 'not reported']);
  if (info.vendor) rows.push(['GPU vendor', info.vendor]);
  rows.push(['WebGL2', info.webgl2 ? 'yes' : info.webgl ? 'no (WebGL1 only: older, slower N64 / PS1 path)' : 'no WebGL']);
  if (info.maxTexture) rows.push(['Max texture', `${info.maxTexture} px`]);
  rows.push(['Screen', `${info.screen.w} × ${info.screen.h} px (${info.screen.cssW} × ${info.screen.cssH} @ ${(+info.screen.dpr).toFixed(2).replace(/\.?0+$/, '')}×)`]);
  rows.push(['Refresh rate', info.refresh ? `≈ ${info.refresh} Hz` : '—']);
  return rows;
}

export async function openPerf(d, { onBack, toast = () => {} } = {}) {
  const perf = loadPerf();
  const body = el('div', { id: 'perf' });
  d.replaceChildren(el('h3', { textContent: 'Performance & device' }), body,
    el('button', { className: 'row ghost', id: 'perf-back', textContent: '‹ Back', onclick: () => (onBack ? onBack() : d.close()) }));
  body.append(el('p', { className: 'muted small', textContent: 'Checking this device…' }));
  const info = await deviceInfo();
  const auto = { ...autoTier(info, perf.bench), at: Date.now() };
  perf.auto = auto; perf.info = { cores: info.cores, renderer: info.renderer, platform: info.platform }; savePerf(perf);

  const table = el('div', { className: 'perf-info', id: 'perf-info' }, ...infoRows(info).map(([k, v]) => el('div', { className: 'perf-kv' }, el('span', { className: 'muted', textContent: k }), el('b', { textContent: v }))));
  const autoLine = el('p', { className: 'small', id: 'perf-auto' });
  const paintAuto = () => { autoLine.textContent = `Auto picks: ${PRESETS[perf.auto.tier].label} — because: ${perf.auto.reasons.join(', ')}.`; };
  paintAuto();
  const radios = el('div', { className: 'perf-modes', id: 'perf-modes' });
  const paintModes = () => radios.replaceChildren(...['auto', 'fast', 'balanced', 'best'].map((m) => el('label', { className: 'row select perf-mode' + (perf.mode === m ? ' on' : '') },
    el('span', {}, el('b', { textContent: m === 'auto' ? `Auto (recommended) → ${PRESETS[perf.auto.tier].short}` : PRESETS[m].label }), el('br'), el('span', { className: 'muted small', textContent: m === 'auto' ? 'Chosen from this device, re-checked whenever you open this page.' : PRESETS[m].blurb })),
    el('input', { type: 'radio', name: 'perf-mode', value: m, id: 'perf-mode-' + m, checked: perf.mode === m, onchange: () => { perf.mode = m; savePerf(perf); paintModes(); toast(`Graphics: ${m === 'auto' ? 'Auto' : PRESETS[m].short} — applies the next time a game starts`); } }))));
  paintModes();
  const benchOut = el('span', { className: 'muted small', id: 'perf-bench-out', textContent: perf.bench ? `Last score: ${perf.bench.score}` : '' });
  const benchBtn = el('button', { className: 'row', id: 'perf-bench', textContent: '⏱ Run benchmark (1 second)', onclick: async () => {
    benchBtn.disabled = true; benchOut.textContent = 'Running… keep this screen open';
    const b = await benchmark(); perf.bench = b; perf.auto = { ...autoTier(info, b), at: Date.now() }; savePerf(perf);
    benchOut.textContent = `Score: ${b.score} (higher is faster; ~300 low-end phone, ~700+ flagship)`; benchBtn.disabled = false; paintAuto(); paintModes();
  } });
  const map = el('details', { className: 'perf-map' }, el('summary', { textContent: 'What each preset changes' }),
    ...['fast', 'balanced', 'best'].map((p) => { const o = presetOptions(p); return el('p', { className: 'small' }, el('b', { textContent: PRESETS[p].short + ': ' }),
      `N64 ${o['mupen64plus-43screensize']}${o['mupen64plus-FrameDuping'] === 'True' ? ' + frame duping' : ''} · PS1 frame skip ${o.pcsx_rearmed_frameskip_type} (Beetle ${o.beetle_psx_hw_internal_resolution}) · PSP ${o.ppsspp_internal_resolution}${o.ppsspp_auto_frameskip === 'enabled' ? ' + auto frame skip' : ''} · filter on 2D: ${presetFilter(p, 'snes')} / handhelds: ${presetFilter(p, 'gba')} · rewind ${p === 'fast' ? 'off' : 'light systems only'} · VSync on`); }),
    el('p', { className: 'muted small', textContent: 'Nintendo DS cores in EmulatorJS 4.2.3 have no resolution or frame-skip options, so DS only follows the filter / rewind part. A screen filter or rewind you pick in the in-game ☰ menu, a per-game Graphics choice (game sheet) and anything you change in ⚙ Emulator settings for one game all win over the preset.' }));
  body.replaceChildren(table, el('h4', { textContent: 'Graphics' }), autoLine, radios, benchBtn, benchOut, map);
}

// Cheats: manual codes (Game Genie, Action Replay, GameShark, Pro Action Replay, raw address:value; whatever the core understands) plus a
// browser for the libretro-database cheat collection (fetched on demand from GitHub). Active cheats are remembered per game and
// re-applied every time the game starts. Codes go to the core through EmulatorJS' setCheat (libretro retro_cheat_set).
const REPO = 'libretro/libretro-database', RAW = `https://raw.githubusercontent.com/${REPO}/master/cht/`, GH = `https://api.github.com/repos/${REPO}`;
export const CHT_DIR = {
  gb: 'Nintendo - Game Boy', gbc: 'Nintendo - Game Boy Color', gba: 'Nintendo - Game Boy Advance', nes: 'Nintendo - Nintendo Entertainment System',
  snes: 'Nintendo - Super Nintendo Entertainment System', n64: 'Nintendo - Nintendo 64', nds: 'Nintendo - Nintendo DS', vb: 'Nintendo - Virtual Boy',
  psx: 'Sony - PlayStation', psp: 'Sony - PlayStation Portable', sms: 'Sega - Master System - Mark III', gg: 'Sega - Game Gear', sg1000: 'Sega - SG-1000',
  md: 'Sega - Mega Drive - Genesis', scd: 'Sega - Mega-CD - Sega CD', s32x: 'Sega - 32X', saturn: 'Sega - Saturn', a2600: 'Atari - 2600', a5200: 'Atari - 5200',
  a7800: 'Atari - 7800', lynx: 'Atari - Lynx', jaguar: 'Atari - Jaguar', ngp: 'SNK - Neo Geo Pocket', ngpc: 'SNK - Neo Geo Pocket Color',
  pce: 'NEC - PC Engine - TurboGrafx 16', pcecd: 'NEC - PC Engine CD - TurboGrafx-CD', pcfx: 'NEC - PC-FX', ws: 'Bandai - WonderSwan', wsc: 'Bandai - WonderSwan Color',
  coleco: 'Coleco - ColecoVision', arcade: 'FBNeo - Arcade Games', dos: 'DOS', doom: 'PrBoom',
};
export const CODE_HINT = {
  nes: 'Game Genie (e.g. SXIOPO), Pro Action Rocky, or raw AAAA:VV', snes: 'Game Genie (DD62-6DAD) or Pro Action Replay (7E0DBF09)',
  gb: 'Game Genie (00A-17B-C49) or GameShark (01FF16D0)', gbc: 'Game Genie or GameShark (01FF16D0)', gba: 'Action Replay / GameShark / CodeBreaker',
  md: 'Game Genie (RFAA-A6VR) or raw AAAAAA:VVVV', sms: 'Pro Action Replay (00C0-0C3F) or Game Genie', gg: 'Game Genie (00C-0C3-F7E) or Pro Action Replay',
  n64: 'GameShark (8033B21E 0008)', psx: 'GameShark (80097CC4 0063)', nds: 'Action Replay DS', psp: 'CWCheat (_L 0x…)',
};

const lsKey = (id) => 'rp.cheats.' + id;
export const loadCheats = (id) => { try { return JSON.parse(localStorage.getItem(lsKey(id)) || '[]'); } catch { return []; } };
export const saveCheats = (id, list) => localStorage.setItem(lsKey(id), JSON.stringify(list));

// .cht → [{desc, code}]
export function parseCht(text) {
  const kv = {}; for (const line of text.split(/\r?\n/)) { const m = /^\s*([\w]+)\s*=\s*"?(.*?)"?\s*$/.exec(line); if (m) kv[m[1]] = m[2]; }
  const n = Number(kv.cheats) || 0, out = [];
  for (let i = 0; i < n; i++) { const code = kv[`cheat${i}_code`]; if (code) out.push({ desc: kv[`cheat${i}_desc`] || `Cheat ${i + 1}`, code }); }
  return out;
}
const norm = (s) => s.toLowerCase().replace(/\.[a-z0-9]{1,4}$/, '').replace(/\(.*?\)|\[.*?\]/g, ' ').replace(/&/g, 'and').replace(/[^a-z0-9]+/g, ' ').trim();
// best matches of a cheat-file list for this game: token overlap with the title and file name
export function rankFiles(files, rom, query = '') {
  const q = norm(query || rom.title || ''), f = norm(rom.file || ''), qt = new Set(q.split(' ').filter(Boolean)), ft = new Set(f.split(' ').filter(Boolean));
  return files.map((name) => {
    const n = norm(name), t = n.split(' ');
    let s = 0; for (const w of t) { if (qt.has(w)) s += 2; else if (ft.has(w)) s += 1; }
    s -= Math.max(0, t.length - qt.size) * 0.3;
    if (n === q || n === f) s += 10; else if (q && n.startsWith(q)) s += 3;
    if (!query && /game genie|action replay|gameshark|pro action/i.test(name)) s -= 0.1;
    return [s, name];
  }).filter(([s]) => s > 0).sort((a, b) => b[0] - a[0]).map(([, n]) => n);
}
async function listFiles(system) {                           // file names of one system folder (2 GitHub API calls, cached 14 days)
  const dir = CHT_DIR[system]; if (!dir) throw new Error('No cheat database for this system');
  const k = 'rp.chtList.' + system;
  try { const c = JSON.parse(localStorage.getItem(k) || 'null'); if (c && Date.now() - c.t < 14 * 864e5) return c.files; } catch {}
  const top = await fetch(`${GH}/contents/cht?ref=master`); if (!top.ok) throw new Error(top.status === 403 ? 'GitHub rate limit reached — try again in an hour' : 'Cheat database unavailable (' + top.status + ')');
  const ent = (await top.json()).find((e) => e.name === dir); if (!ent) throw new Error('No cheat folder for this system');
  const tr = await fetch(`${GH}/git/trees/${ent.sha}`); if (!tr.ok) throw new Error('Cheat database unavailable (' + tr.status + ')');
  const files = (await tr.json()).tree.filter((t) => t.type === 'blob' && t.path.endsWith('.cht')).map((t) => t.path.slice(0, -4));
  try { localStorage.setItem(k, JSON.stringify({ t: Date.now(), files })); } catch {}
  return files;
}
async function fetchCht(system, name) {
  const r = await fetch(RAW + encodeURIComponent(CHT_DIR[system]) + '/' + encodeURIComponent(name) + '.cht');
  if (!r.ok) throw new Error('Could not download cheats (' + r.status + ')');
  return parseCht(await r.text());
}

// apply all enabled cheats to the running core (indices are renumbered every time)
export function applyCheats(gm, id) {
  if (!gm) return 0;
  try { gm.resetCheat(); } catch {}
  let i = 0;
  for (const c of loadCheats(id)) if (c.on) { try { gm.setCheat(i++, 1, c.code); } catch (e) { console.warn('cheat', c, e); } }
  return i;
}

const el = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); for (const k of kids) if (k != null && k !== '') e.append(k); return e; };
export function cheatsPanel({ rom, gm, say = () => {} }) {
  const root = el('div', { className: 'net-panel cheat-panel', id: 'cheat-panel' });
  const apply = () => { const n = applyCheats(gm(), rom.id); return n; };
  const draw = () => {
    const list = loadCheats(rom.id);
    const desc = el('input', { id: 'cheat-desc', placeholder: 'Name (optional)' }), code = el('input', { id: 'cheat-code', placeholder: CODE_HINT[rom.system] || 'Cheat code', autocapitalize: 'characters', spellcheck: false });
    root.replaceChildren(
      el('h4', { textContent: `Active cheats (${list.filter((c) => c.on).length}/${list.length})` }),
      list.length ? '' : el('p', { className: 'small', textContent: 'No cheats yet. Add a code below or browse the cheat database.' }),
      ...list.map((c, i) => el('div', { className: 'cheat-row' },
        el('label', {}, el('input', { type: 'checkbox', className: 'cheat-on', checked: !!c.on, onchange: (e) => { const l = loadCheats(rom.id); l[i].on = e.target.checked; saveCheats(rom.id, l); const n = apply(); say(`${n} cheat${n === 1 ? '' : 's'} active`); draw(); } }),
          el('span', {}, el('b', { textContent: c.desc }), el('small', { textContent: c.code }))),
        el('button', { className: 'ghost', textContent: '✕', title: 'Remove', onclick: () => { const l = loadCheats(rom.id); l.splice(i, 1); saveCheats(rom.id, l); apply(); draw(); } }))),
      el('h4', { textContent: 'Add a code' }),
      el('p', { className: 'small', textContent: `Formats: ${CODE_HINT[rom.system] || 'whatever this core supports'}. Join several codes with +.` }),
      desc, code,
      el('button', { className: 'primary', id: 'cheat-add', textContent: '＋ Add & enable', onclick: () => {
        const cv = code.value.trim().replace(/\s*\n\s*/g, '+'); if (!cv) { say('Enter a code'); return; }
        const l = loadCheats(rom.id); l.push({ desc: desc.value.trim() || cv.slice(0, 24), code: cv, on: true }); saveCheats(rom.id, l); const n = apply(); say(`Cheat added (${n} active)`); draw();
      } }),
      CHT_DIR[rom.system] ? el('button', { id: 'cheat-browse', textContent: '📚 Browse cheat database…', onclick: () => browse() }) : '',
      list.length ? el('button', { className: 'ghost', id: 'cheat-clear', textContent: 'Turn all off', onclick: () => { saveCheats(rom.id, loadCheats(rom.id).map((c) => ({ ...c, on: false }))); apply(); draw(); } }) : '');
  };
  const browse = async (query = '') => {
    const search = el('input', { id: 'cheat-search', value: query, placeholder: 'Search game name…', type: 'search' });
    const results = el('div', { id: 'cheat-results' }, el('p', { className: 'small', textContent: 'Loading cheat list…' }));
    search.addEventListener('keydown', (e) => { if (e.key === 'Enter') browse(search.value); });
    root.replaceChildren(el('h4', { textContent: 'Cheat database (libretro)' }), search, el('button', { textContent: '🔍 Search', onclick: () => browse(search.value) }), results,
      el('button', { className: 'ghost', textContent: '‹ Back to active cheats', onclick: draw }));
    try {
      const top = rankFiles(await listFiles(rom.system), rom, query).slice(0, 40);
      results.replaceChildren(...(top.length ? top.map((n) => el('button', { className: 'cheat-file', textContent: n, onclick: () => pick(n) })) : [el('p', { className: 'small', textContent: 'No match. Try a shorter name.' })]));
    } catch (e) { results.replaceChildren(el('p', { className: 'err', textContent: e.message })); }
  };
  const pick = async (name) => {
    root.replaceChildren(el('h4', { textContent: name }), el('p', { className: 'small', textContent: 'Loading…' }));
    try {
      const cheats = await fetchCht(rom.system, name), have = new Set(loadCheats(rom.id).map((c) => c.code));
      root.replaceChildren(el('h4', { textContent: `${name} — ${cheats.length} cheats` }),
        el('p', { className: 'small', textContent: 'Tap to add (enabled). Codes are made for the matching ROM version; a wrong version can glitch or crash — just turn it off again.' }),
        ...cheats.map((c) => el('button', { className: 'cheat-db' + (have.has(c.code) ? ' added' : ''), disabled: have.has(c.code), onclick: (e) => {
          const l = loadCheats(rom.id); l.push({ desc: c.desc, code: c.code, on: true }); saveCheats(rom.id, l); const n = apply(); say(`“${c.desc}” on (${n} active)`); e.currentTarget.disabled = true; e.currentTarget.classList.add('added');
        } }, el('b', { textContent: c.desc }), el('small', { textContent: c.code.length > 60 ? c.code.slice(0, 60) + '…' : c.code }))),
        el('button', { className: 'ghost', textContent: '‹ Back to active cheats', onclick: draw }));
    } catch (e) { root.replaceChildren(el('p', { className: 'err', textContent: e.message }), el('button', { className: 'ghost', textContent: '‹ Back', onclick: draw })); }
  };
  draw();
  return root;
}

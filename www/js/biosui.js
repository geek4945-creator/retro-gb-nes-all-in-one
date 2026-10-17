// Settings -> BIOS files: pick a system from the dropdown, see which files it looks for (installed / missing, required / recommended /
// optional, expected md5), download the free open-source ones in one tap, or upload your own dumps. Everything is stored on this
// device (IndexedDB) and only ever handed to the emulator. Commercial BIOS files are never bundled or downloaded.
import * as db from './db.js';
import { SYSTEMS, GROUPS, sortedSystemKeys } from './cores.js';
import { biosSystems, saveBiosFiles, biosReport, openFilesFor, allOpenFiles, downloadOpen, biosKey } from './bios.js';
import { BUILTIN, docsUrl, BIOS_DOCS } from './biosdata.js';

const el = (tag, props = {}, ...kids) => {
  const e = Object.assign(document.createElement(tag), props);
  for (const k of kids) if (k != null) e.append(k);
  return e;
};
const link = (href, text) => el('a', { href, textContent: text, target: '_blank', rel: 'noopener noreferrer' });
const kb = (n) => (n < 1024 ? `${n} B` : `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`);

let current = null;                         // selected system key (kept while the dialog is re-rendered)
let note = null;                            // { text, bad } result of the last action, shown inside the dialog (a toast would sit behind the modal)

/** Summary for the dropdown / badge: { text, cls } */
function summarize(rep) {
  const have = rep.files.filter((x) => x.stored), req = rep.files.filter((x) => x.level === 'required');
  const needs = req.length > 0 && !req.some((x) => x.stored);
  if (needs) return { text: '⚠ needed', cls: 'need' };
  if (have.length) return { text: `✓ ${have.length} installed`, cls: 'ok' };
  if (rep.open.length) return { text: 'open files available', cls: '' };
  return { text: rep.files.some((x) => x.level === 'recommended') ? 'optional+' : 'optional', cls: '' };
}

export async function openBios(dlg, toast, select) {
  const keys = sortedSystemKeys().filter((k) => biosSystems().includes(k));
  if (select) current = select;
  if (!current || !keys.includes(current)) current = keys[0];
  const reps = {}; for (const k of keys) reps[k] = await biosReport(k);
  const rerender = () => openBios(dlg, toast);

  // ---- system dropdown
  const sel = el('select', { id: 'bios-system', className: 'bios-select', ariaLabel: 'System' });
  for (const g of GROUPS) {
    const ks = keys.filter((k) => SYSTEMS[k].group === g); if (!ks.length) continue;
    const og = el('optgroup', { label: g });
    for (const k of ks) og.append(el('option', { value: k, textContent: `${SYSTEMS[k].label} — ${summarize(reps[k]).text}`, selected: k === current }));
    sel.append(og);
  }
  sel.onchange = () => { current = sel.value; rerender(); };

  // ---- shared state for downloads (progress bar + message live outside the per-system panel so they survive a re-render)
  const prog = el('progress', { className: 'bios-prog', max: 1, value: 0, hidden: true });
  const msg = el('p', { className: 'small bios-msg ' + (note && note.bad ? 'warnline' : 'muted'), textContent: note ? note.text : '', role: 'status' });
  const said = note; note = null; void said;
  let busy = false;
  const run = async (files, label) => {
    if (busy || !files.length) return;
    busy = true; dlg.querySelectorAll('button.dl').forEach((b) => (b.disabled = true));
    prog.hidden = false; prog.value = 0; msg.className = 'muted small bios-msg'; msg.textContent = `Downloading ${label}…`;
    const r = await downloadOpen(files, { onProgress: (p) => { prog.value = p.total ? p.loaded / p.total : 0; msg.textContent = `Downloading ${p.file.name} (${Math.min(p.index + 1, p.count)}/${p.count})…`; } });
    busy = false;
    if (r.failed.length) { note = { bad: true, text: `Could not install ${r.failed.map((x) => x.name).join(', ')}: ${r.failed[0].error}` + (r.saved.length ? ` (installed: ${r.saved.join(', ')})` : '') }; toast(note.text, { sticky: 8000 }); }
    else { note = { text: `Installed ${r.saved.join(', ')} ✓ (size and md5 verified)` }; toast(`Installed ${r.saved.length} open BIOS file${r.saved.length > 1 ? 's' : ''}`); }
    await rerender();
  };

  // ---- upload (hidden chooser shared by every panel)
  const picker = el('input', { type: 'file', multiple: true, hidden: true });
  picker.onchange = async () => {
    const files = [...picker.files]; picker.value = '';
    if (!files.length) return;
    const { saved, unknown } = await saveBiosFiles(current, files);
    const t = saved.length ? `Saved ${saved.length} BIOS file${saved.length > 1 ? 's' : ''}` + (unknown.length ? ` — “${unknown[0]}” is not a name this system looks for` : '') : 'Nothing saved';
    note = { text: t, bad: !!unknown.length || !saved.length }; toast(t);
    await rerender();
  };

  // ---- per-system panel
  const k = current, rep = reps[k], spec = rep.spec, sum = summarize(rep), open = rep.open;
  const openNames = new Set(open.map((o) => o.name));
  const closed = rep.files.filter((x) => !openNames.has(x.name) && x.stored == null && x.verdict === 'missing');
  const rows = rep.files.map((x) => {
    const st = x.stored, v = x.verdict;
    const status = v === 'missing' ? el('span', { className: 'bios-st miss', textContent: '✗ Missing' })
      : el('span', { className: 'bios-st ' + (v === 'differs' ? 'warnline' : 'good'), textContent: `✓ Installed · ${kb(st.size)}` + ({ ok: ' · md5 verified', open: ' · open-source replacement', differs: ' · md5 differs from the usual dump (may still work)', unknown: '' }[v] || '') });
    return el('div', { className: 'bios-row' },
      el('div', { className: 'bios-top' }, el('strong', { textContent: x.name }), el('span', { className: 'lvl ' + x.level, textContent: x.level }), st ? el('button', { type: 'button', className: 'mini', textContent: 'Remove', onclick: async () => { await db.deleteBios(st.id); await rerender(); } }) : null),
      status,
      x.note ? el('div', { className: 'muted small', textContent: x.note }) : null,
      x.md5 ? el('div', { className: 'muted small mono', textContent: 'md5 ' + x.md5 }) : null);
  });

  const panel = [
    el('div', { className: 'bios-head' }, el('strong', { textContent: SYSTEMS[k].label }), el('span', { className: 'bios-badge ' + sum.cls, textContent: sum.text })),
    SYSTEMS[k].biosFrom || (k === 'neogeo') ? el('p', { className: 'muted small', textContent: 'The same Neo Geo BIOS is used by Neo Geo, Arcade (FinalBurn Neo) and Arcade (MAME 2003+).' }) : null,
    spec.note ? el('p', { className: 'muted small', textContent: spec.note }) : null,
    BUILTIN[k] ? el('p', { className: 'bios-builtin small', textContent: '✓ ' + BUILTIN[k] }) : null,
    ...rows,
  ];

  if (open.length) {
    const todo = open.filter((o) => !rep.files.some((x) => x.name === o.name && x.stored && x.stored.open));
    panel.push(el('div', { className: 'bios-open' },
      el('h4', { textContent: 'Free, open-source files' }),
      ...open.map((o) => el('div', { className: 'small' },
        el('strong', { textContent: o.label }), ` → ${o.name} (${kb(o.size)}) · `,
        link(o.licenseUrl, o.license + ' licence'), ' · ', link(o.source, 'source'),
        el('div', { className: 'muted', textContent: o.note }))),
      el('button', { type: 'button', className: 'row primary dl', textContent: todo.length ? `⬇ Download open files (${todo.length})` : '⬇ Download again', onclick: () => run(open, SYSTEMS[k].label) })));
  }

  if (closed.length) {
    const names = closed.map((x) => x.name + (x.md5 ? ` (md5 ${x.md5})` : '')).join('; ');
    panel.push(el('div', { className: 'bios-closed' },
      el('strong', { textContent: '🔒 Must come from your own console' }),
      el('p', { className: 'small', textContent: `${closed.length === 1 ? 'This file is' : 'These files are'} copyrighted, so Retro Pocket cannot include or download ${closed.length === 1 ? 'it' : 'them'}. Dump ${closed.length === 1 ? 'it' : 'them'} from your own console (or the ${SYSTEMS[k].label} hardware you own) and add ${closed.length === 1 ? 'it' : 'them'} with the button below. Expected: ${names}.` })));
  }
  panel.push(el('button', { type: 'button', className: 'row', textContent: spec.mode === 'raw' ? '＋ Upload BIOS (.zip kept as-is)' : '＋ Upload BIOS file(s) or a .zip of them', onclick: () => { picker.accept = ''; picker.click(); } }));
  panel.push(el('p', { className: 'small' }, link(docsUrl(biosKey(k)), 'libretro documentation for ' + SYSTEMS[k].label + ' ↗'), ' · ', link(BIOS_DOCS, 'all libretro BIOS docs ↗')));

  const everything = allOpenFiles();
  dlg.replaceChildren(
    el('h3', { textContent: 'BIOS files' }),
    el('p', { className: 'muted small', textContent: 'Some systems need the console’s BIOS/firmware. Original BIOS files are copyrighted and NOT included or downloaded — dump them from your own console. Free open-source replacements can be downloaded below. Everything stays on this device (IndexedDB) and is only handed to the emulator.' }),
    sel,
    el('div', { className: 'bios-panel' }, ...panel),
    everything.length ? el('button', { type: 'button', className: 'row dl', id: 'bios-all', textContent: `⬇ Download all open files (${everything.length}, ${kb(everything.reduce((n, o) => n + o.size, 0))})`, onclick: () => run(everything, 'all open files') }) : null,
    prog, msg, picker,
    el('button', { className: 'row ghost', textContent: 'Back', onclick: () => { dlg.close(); } }));
  if (!dlg.open) dlg.showModal();
}

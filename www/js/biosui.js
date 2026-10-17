// Settings -> BIOS files: per-system upload (stored in IndexedDB on this device, never uploaded anywhere, never bundled).
import * as db from './db.js';
import { SYSTEMS, GROUPS, sortedSystemKeys } from './cores.js';
import { biosSystems, saveBiosFiles, biosStatus } from './bios.js';

const el = (tag, props = {}, ...kids) => {
  const e = Object.assign(document.createElement(tag), props);
  for (const k of kids) e.append(k);
  return e;
};

export async function openBios(dlg, toast) {
  const keys = sortedSystemKeys().filter((k) => biosSystems().includes(k));
  const stat = {};
  for (const k of keys) stat[k] = await biosStatus(k);
  const picker = el('input', { type: 'file', multiple: true, hidden: true });
  let target = null;
  picker.onchange = async () => {
    const files = [...picker.files]; picker.value = '';
    if (!files.length || !target) return;
    const { saved, unknown } = await saveBiosFiles(target, files);
    toast(saved.length ? `Saved ${saved.length} BIOS file${saved.length > 1 ? 's' : ''}` + (unknown.length ? ` — “${unknown[0]}” is not a name this system looks for` : '') : 'Nothing saved');
    await openBios(dlg, toast);
  };
  const rows = [];
  for (const k of keys) {
    const s = SYSTEMS[k], st = stat[k], spec = st.spec;
    const badge = st.have.length ? `✓ ${st.have.length}` : st.needs ? '⚠ needed' : spec.files.some((x) => x.level === 'recommended') ? 'optional+' : 'optional';
    const stored = (await db.biosFor(k));
    const body = [
      spec.note ? el('p', { className: 'muted small', textContent: spec.note }) : null,
      el('p', { className: 'muted small', textContent: 'Looks for: ' + spec.files.map((x) => `${x.name} (${x.level}${x.note ? ', ' + x.note : ''})`).join('; ') }),
      ...stored.map((b) => el('div', { className: 'bios-file' }, el('span', { textContent: `${b.name} · ${(b.size / 1024).toFixed(0)} KB` }),
        el('button', { type: 'button', className: 'mini', textContent: 'Remove', onclick: async () => { await db.deleteBios(b.id); await openBios(dlg, toast); } }))),
      el('button', { type: 'button', className: 'row', textContent: spec.mode === 'raw' ? '＋ Upload BIOS (.zip kept as-is)' : '＋ Upload BIOS file(s) or a .zip of them', onclick: () => { target = k; picker.accept = ''; picker.click(); } }),
    ].filter(Boolean);
    const d = el('details', { className: 'bios-sys' }, el('summary', {}, el('span', { textContent: s.label }), el('span', { className: 'bios-badge' + (st.needs ? ' need' : st.have.length ? ' ok' : ''), textContent: badge })), ...body);
    if (st.have.length || st.needs) d.open = false;
    rows.push(d);
  }
  dlg.replaceChildren(
    el('h3', { textContent: 'BIOS files' }),
    el('p', { className: 'muted small', textContent: 'Some systems need the original console BIOS/firmware. These are copyrighted and NOT included — dump them from your own console and add them here. They stay on this device (IndexedDB) and are only handed to the emulator.' }),
    ...rows, picker,
    el('button', { className: 'row ghost', textContent: 'Back', onclick: () => { dlg.close(); } }));
  if (!dlg.open) dlg.showModal();
}

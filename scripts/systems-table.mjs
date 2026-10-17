// Generates the supported-systems table for the README from www/js/cores.js (single source of truth).
//   node scripts/systems-table.mjs          print it
//   node scripts/systems-table.mjs --write  update README.md between the <!-- systems:start/end --> markers
import { readFileSync, writeFileSync } from 'node:fs';
import { SYSTEMS, GROUPS, AMBIGUOUS, CORE_LABELS, sortedSystemKeys } from '../www/js/cores.js';
export function table() {
  const rows = ['| System | Add as | Default core (alternates) | BIOS | Notes |', '|---|---|---|---|---|'];
  for (const k of sortedSystemKeys()) {
    const s = SYSTEMS[k];
    const own = s.exts.map((e) => '`.' + e + '`');
    const amb = Object.entries(AMBIGUOUS).filter(([, v]) => v.includes(k)).map(([e]) => '`.' + e + '`');
    const add = [...own.slice(0, 7), ...(own.length > 7 ? ['…'] : []), ...(amb.length ? [`${amb.slice(0, 6).join(' ')}${amb.length > 6 ? ' …' : ''} *(asks which system)*`] : [])].join(' ') || '—';
    const core = (c) => '`' + c + '`';
    const cores = core(s.cores[0]) + (s.cores.length > 1 ? ' (' + s.cores.slice(1).map(core).join(', ') + ')' : '');
    const bios = s.biosFrom ? `shares ${SYSTEMS[s.biosFrom].label} BIOS (optional)` : s.bios ? s.bios.files.map((f) => `${f.name}${f.level === 'required' ? ' **required**' : f.level === 'recommended' ? ' recommended' : ' optional'}`).join(', ') : 'none';
    const notes = [s.heavy ? '⚠ heavy' : '', s.analog ? 'analog' : '', `${s.players}P`, s.experimental ? 'experimental' : '', s.hint || ''].filter(Boolean).join(' · ');
    rows.push(`| **${s.label}** (${s.group}) | ${add} | ${cores} | ${bios} | ${notes} |`);
  }
  return rows.join('\n');
}
if (process.argv[1] === new URL(import.meta.url).pathname) {
  if (process.argv.includes('--write')) {
    const p = new URL('../README.md', import.meta.url).pathname; let t = readFileSync(p, 'utf8');
    t = t.replace(/<!-- systems:start -->[\s\S]*<!-- systems:end -->/, `<!-- systems:start -->\n${table()}\n<!-- systems:end -->`);
    writeFileSync(p, t); console.log('README table updated');
  } else console.log(table());
}

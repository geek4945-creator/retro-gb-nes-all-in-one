// Static sanity checks: JS syntax (as ES modules / classic script), manifest, icons, SW precache list.
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
const root = new URL('../www/', import.meta.url).pathname;
let bad = 0; const fail = (m) => { console.error('FAIL', m); bad++; };
for (const f of readdirSync(join(root, 'js'))) {
  try { execFileSync(process.execPath, ['--check', '--input-type=module', '-'], { input: readFileSync(join(root, 'js', f)), stdio: ['pipe', 'pipe', 'pipe'] }); console.log('ok  js/' + f); }
  catch (e) {
    // `node --check -` with --input-type is not supported everywhere: fall back to a temp .mjs copy
    try { execFileSync(process.execPath, ['--check', '--experimental-default-type=module', join(root, 'js', f)]); console.log('ok  js/' + f); }
    catch (e2) { fail('syntax js/' + f + '\n' + (e2.stderr || e2)); }
  }
}
try { execFileSync(process.execPath, ['--check', join(root, 'sw.js')]); console.log('ok  sw.js'); } catch (e) { fail('syntax sw.js ' + e.stderr); }
const m = JSON.parse(readFileSync(join(root, 'manifest.webmanifest'), 'utf8'));
for (const i of m.icons) if (!existsSync(join(root, i.src))) fail('missing icon ' + i.src);
const sw = readFileSync(join(root, 'sw.js'), 'utf8');
const list = [...sw.match(/SHELL_FILES = \[([\s\S]*?)\];/)[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
for (const f of list) if (f !== './' && !existsSync(join(root, f))) fail('SW precache missing ' + f);
for (const html of ['index.html', 'player.html']) {
  const t = readFileSync(join(root, html), 'utf8');
  for (const r of t.matchAll(/(?:src|href)="([^"#?]+)"/g)) if (!/^(https?:|data:)/.test(r[1]) && !existsSync(join(root, r[1]))) fail(`${html} references missing ${r[1]}`);
}
// README systems table must be regenerated after editing www/js/cores.js (npm run systems-table)
try {
  const { table } = await import('./systems-table.mjs');
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  if (!readme.includes(table())) fail('README systems table is out of date: run  node scripts/systems-table.mjs --write');
  else console.log('ok  README systems table in sync');
} catch (e) { fail('systems table check: ' + e.message); }
// Open-licensed BIOS mirror: every entry must match its file exactly, carry a licence + https source, and nothing else may be stored there.
try {
  const { createHash } = await import('node:crypto');
  const { OPEN_FILES, DOCS } = await import('../www/js/biosdata.js');
  const { SYSTEMS } = await import('../www/js/cores.js');
  const dir = join(root, 'bios-open');
  const listed = new Set(OPEN_FILES.map((o) => o.url.replace('bios-open/', '')));
  for (const o of OPEN_FILES) {
    const p = join(root, o.url);
    if (!existsSync(p)) { fail('open BIOS missing ' + o.url); continue; }
    const b = readFileSync(p);
    if (b.length !== o.size) fail(`${o.url}: size ${b.length} != ${o.size}`);
    if (createHash('md5').update(b).digest('hex') !== o.md5) fail(`${o.url}: md5 differs from biosdata.js`);
    if (!existsSync(join(root, o.licenseUrl))) fail(`${o.url}: licence file missing`);
    if (!/^https:\/\//.test(o.source) || /archive\.org/i.test(o.source)) fail(`${o.url}: source must be an https upstream project`);
    if (!/^(MIT|Expat|BSD|GPL|LGPL|Apache|CC0|Zlib|MPL|APL|Public)/i.test(o.license)) fail(`${o.url}: licence "${o.license}" not recognised as open`);
    if (!SYSTEMS[o.system] || !SYSTEMS[o.system].bios || !SYSTEMS[o.system].bios.files.some((x) => x.name === o.name)) fail(`${o.url}: not a file ${o.system} looks for`);
  }
  for (const f of readdirSync(dir)) if (!listed.has(f) && !['licenses', 'README.md'].includes(f)) fail('unlisted file in bios-open/: ' + f + ' (only open-licensed files declared in biosdata.js may be stored)');
  for (const [k, sy] of Object.entries(SYSTEMS)) if (sy.bios) {
    if (!DOCS[k]) fail('no libretro docs slug for BIOS system ' + k);
    for (const x of sy.bios.files) if (x.md5 && !/^[0-9a-f]{32}$/.test(x.md5)) fail(`bad md5 for ${k}/${x.name}`);
  }
  console.log('ok  open BIOS mirror (' + OPEN_FILES.length + ' files, checksums + licences)');
} catch (e) { fail('open BIOS check: ' + e.message); }
console.log(bad ? `${bad} problem(s)` : 'all checks passed'); process.exit(bad ? 1 : 0);

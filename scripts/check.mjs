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
console.log(bad ? `${bad} problem(s)` : 'all checks passed'); process.exit(bad ? 1 : 0);

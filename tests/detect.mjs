// Unit tests for system detection, ZIP writer/reader and cue parsing (pure Node, no browser).
import { detect, storedZip, zipNames, parseCue, parseM3u, sniffHead, crc32 } from '../www/js/detect.js';
import { SYSTEMS, EXT_TO_SYSTEM, AMBIGUOUS, systemFor, defaultCore, altCore, CORE_LABELS } from '../www/js/cores.js';
import { REPOS } from '../www/js/art.js';
import { readFileSync } from 'node:fs';
let bad = 0; const ok = (c, m) => { if (!c) { bad++; console.log('FAIL', m); } else console.log('PASS', m); };
const F = (name, bytes) => Object.assign(new Blob([bytes]), { name });
ok(systemFor('Mario.NES') === 'nes' && systemFor('a.z64') === 'n64' && systemFor('x.sms') === 'sms' && systemFor('x.gg') === 'gg' && systemFor('x.md') === 'md', 'unique extensions');
ok(systemFor('x.bin') === null && systemFor('x.iso') === null && systemFor('x.cue') === null && systemFor('x.zip') === null, 'ambiguous extensions are not auto-assigned');
ok(Object.values(EXT_TO_SYSTEM).every((k) => SYSTEMS[k]), 'every extension points at a system');
ok(Object.values(AMBIGUOUS).flat().every((k) => SYSTEMS[k]), 'every ambiguity candidate is a system');
for (const [k, s] of Object.entries(SYSTEMS)) { ok(s.cores.length && s.cores.every((c) => CORE_LABELS[c]), `${k}: cores labelled`); ok(defaultCore(k) === s.cores[0] || k === 'n64', `${k}: default core`); ok(s.art && s.label && s.short && s.color && s.group && s.players, `${k}: metadata`); }
ok(altCore('nes', 'nestopia') === 'fceumm' && altCore('snes', 'snes9x') === null, 'alt cores');
// every core must exist in the pinned EmulatorJS cores list (cores.json captured from the CDN) if available
try {
  const list = JSON.parse(readFileSync('tests/data/cores-4.2.3.json', 'utf8')).map((c) => c.name);
  for (const s of Object.values(SYSTEMS)) for (const c of s.cores) ok(list.includes(c), `core ${c} exists in EmulatorJS 4.2.3`);
} catch { console.log('SKIP core list check (tests/data/cores-4.2.3.json missing)'); }
// header sniffing
const nes = new Uint8Array(64); nes.set([0x4e, 0x45, 0x53, 0x1a]);
ok(sniffHead(nes)[0] === 'nes', 'sniff NES');
const n64 = new Uint8Array(64); n64.set([0x80, 0x37, 0x12, 0x40]);
ok((await detect(F('game.bin', n64))).system === 'n64', 'bin with N64 header -> n64');
const md = new Uint8Array(0x300); md.set(new TextEncoder().encode('SEGA MEGA DRIVE '), 0x100);
ok((await detect(F('sonic.bin', md))).system === 'md', 'bin with SEGA header -> md');
const sms = new Uint8Array(0x8000); sms.set(new TextEncoder().encode('TMR SEGA'), 0x7ff0); sms[0x7fff] = 0x4c;
ok((await detect(F('x.bin', sms))).system === 'sms', 'TMR SEGA -> sms'); sms[0x7fff] = 0x6c;
ok((await detect(F('x.bin', sms))).system === 'gg', 'TMR SEGA region 6 -> game gear');
const psx = new Uint8Array(0x20000); psx.set(new TextEncoder().encode('PLAYSTATION '), 0x8008);
const dp = await detect(F('game.iso', psx)); ok(dp.system === 'psx', 'iso with PLAYSTATION id -> psx');
const scd = new Uint8Array(0x20000); scd.set(new TextEncoder().encode('SEGADISCSYSTEM  '), 0);
ok((await detect(F('x.bin', scd))).system === 'scd', 'SEGADISCSYSTEM -> sega cd');
const blank = await detect(F('mystery.bin', new Uint8Array(4096)));
ok(!blank.system && blank.candidates.length > 3 && blank.candidates[0] !== 'psx', 'unknown small .bin -> picker, cartridge systems first');
const blankBig = await detect(F('mystery.bin', { length: 0 } && new Uint8Array(0x300000)));
ok(!blankBig.system && ['psx', 'scd', 'saturn', 'pcecd', 'threedo'].includes(blankBig.candidates[0]), 'large unknown .bin -> disc systems first');
// zips
const z1 = await storedZip([{ name: 'Mario.nes', data: nes }]);
ok(JSON.stringify(await zipNames(z1)) === '["Mario.nes"]', 'zip writer + reader');
ok((await detect(Object.assign(z1, { name: 'x.zip' }))).system === 'nes', 'zip containing .nes -> nes');
const z2 = await storedZip([{ name: 'sf2.rom', data: new Uint8Array(10) }, { name: 'sf2.u1', data: new Uint8Array(10) }]);
const d2 = await detect(Object.assign(z2, { name: 'sf2.zip' })); ok(!d2.system && d2.candidates.includes('arcade') && d2.candidates.includes('neogeo'), 'romset zip -> arcade picker');
const z3 = await storedZip([{ name: 'Game.cue', data: new TextEncoder().encode('FILE "Game.bin" BINARY') }, { name: 'Game.bin', data: new Uint8Array(10) }]);
const d3 = await detect(Object.assign(z3, { name: 'g.zip' })); ok(!d3.system && d3.candidates.includes('psx') && d3.candidates.includes('saturn'), 'zip with cue -> disc picker');
const z4 = await storedZip([{ name: 'DOOM/DOOM.EXE', data: new Uint8Array(10) }]);
ok((await detect(Object.assign(z4, { name: 'doom.zip' }))).likely[0] === 'dos', 'zip with exe -> DOS likely');
// zip validity by external tool is checked in the browser tests; check crc here
ok(crc32(new TextEncoder().encode('123456789')) === 0xcbf43926, 'crc32 check value');
ok(JSON.stringify(parseCue('FILE "Game (Track 1).bin" BINARY\n  TRACK 01 MODE2/2352\nFILE "Game (Track 2).bin" BINARY')) === '["Game (Track 1).bin","Game (Track 2).bin"]', 'cue parsing');
ok(JSON.stringify(parseM3u('#EXTM3U\nDisc 1.cue\r\nsub/Disc 2.cue\n')) === '["Disc 1.cue","Disc 2.cue"]', 'm3u parsing');
console.log(bad ? `${bad} FAILED` : 'all detect tests passed'); process.exit(bad ? 1 : 0);

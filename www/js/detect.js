// Content-based system detection, ZIP helpers and cue/bin bundling. Pure functions (also unit-tested in Node: tests/detect.mjs).
import { AMBIGUOUS, EXT_TO_SYSTEM, extOf } from './cores.js';

/* ---------- CRC32 + stored (uncompressed) ZIP writer ---------- */
const CRC_T = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
export function crc32(u8, crc = 0) { let c = ~crc >>> 0; for (let i = 0; i < u8.length; i++) c = CRC_T[(c ^ u8[i]) & 255] ^ (c >>> 8); return ~c >>> 0; }

/** Builds a STORED zip from [{ name, data: Blob|File|Uint8Array|ArrayBuffer }]. Returns a Blob (no big in-memory copy). */
export async function storedZip(entries) {
  const enc = new TextEncoder(), parts = [], central = []; let offset = 0;
  for (const e of entries) {
    const blob = e.data instanceof Blob ? e.data : new Blob([e.data]);
    const name = enc.encode(e.name);
    let crc = 0;
    for (let p = 0; p < blob.size; p += 8 << 20) crc = crc32(new Uint8Array(await blob.slice(p, p + (8 << 20)).arrayBuffer()), crc);
    const big = blob.size >= 0xffffffff; if (big) throw new Error('File too large for a ZIP bundle');
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
    h.setUint16(10, 0, true); h.setUint16(12, 0x21, true); h.setUint32(14, crc, true); h.setUint32(18, blob.size, true); h.setUint32(22, blob.size, true);
    h.setUint16(26, name.length, true); h.setUint16(28, 0, true);
    parts.push(h.buffer, name, blob);
    central.push({ name, crc, size: blob.size, offset });
    offset += 30 + name.length + blob.size;
  }
  let cdSize = 0;
  for (const c of central) {
    const h = new DataView(new ArrayBuffer(46));
    h.setUint32(0, 0x02014b50, true); h.setUint16(4, 20, true); h.setUint16(6, 20, true); h.setUint16(8, 0x0800, true); h.setUint16(10, 0, true);
    h.setUint16(12, 0, true); h.setUint16(14, 0x21, true); h.setUint32(16, c.crc, true); h.setUint32(20, c.size, true); h.setUint32(24, c.size, true);
    h.setUint16(28, c.name.length, true); h.setUint32(42, c.offset, true);
    parts.push(h.buffer, c.name); cdSize += 46 + c.name.length;
  }
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, central.length, true); end.setUint16(10, central.length, true);
  end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
  parts.push(end.buffer);
  return new Blob(parts, { type: 'application/zip' });
}

/** File names inside a ZIP (central directory), or null when the blob is not a readable ZIP. */
export async function zipNames(blob) {
  try {
    const tailLen = Math.min(blob.size, 66000), tail = new Uint8Array(await blob.slice(blob.size - tailLen).arrayBuffer());
    let i = tail.length - 22; while (i >= 0 && !(tail[i] === 0x50 && tail[i + 1] === 0x4b && tail[i + 2] === 5 && tail[i + 3] === 6)) i--;
    if (i < 0) return null;
    const dv = new DataView(tail.buffer, tail.byteOffset + i), n = dv.getUint16(10, true), size = dv.getUint32(12, true), off = dv.getUint32(16, true);
    if (off === 0xffffffff || off + size > blob.size) return null;
    const cd = new Uint8Array(await blob.slice(off, off + size).arrayBuffer()), cv = new DataView(cd.buffer), out = []; let p = 0;
    for (let k = 0; k < n && p + 46 <= cd.length && cv.getUint32(p, true) === 0x02014b50; k++) {
      const nl = cv.getUint16(p + 28, true), el = cv.getUint16(p + 30, true), cl = cv.getUint16(p + 32, true);
      out.push(new TextDecoder().decode(cd.subarray(p + 46, p + 46 + nl))); p += 46 + nl + el + cl;
    }
    return out;
  } catch { return null; }
}

/* ---------- cue sheets ---------- */
export function parseCue(text) {
  const files = []; for (const m of String(text).matchAll(/^\s*FILE\s+(?:"([^"]+)"|(\S+))/gim)) files.push((m[1] || m[2]).split(/[\\/]/).pop());
  return files;
}
export function parseM3u(text) { return String(text).split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).map((l) => l.split(/[\\/]/).pop()); }

/* ---------- header sniffing ---------- */
const ascii = (u8, off, len) => { let s = ''; for (let i = off; i < Math.min(u8.length, off + len); i++) s += u8[i] >= 32 && u8[i] < 127 ? String.fromCharCode(u8[i]) : '\0'; return s; };
const has = (u8, s, from = 0, to = u8.length) => { const n = ascii(u8, from, to - from); return n.includes(s); };

/** Reads the first bytes of a cartridge/disc image and returns the systems it most likely belongs to (best first). */
export function sniffHead(u8) {
  const out = []; const add = (k) => { if (!out.includes(k)) out.push(k); };
  if (u8[0] === 0x4e && u8[1] === 0x45 && u8[2] === 0x53 && u8[3] === 0x1a) add('nes');
  const w = (u8[0] << 24 | u8[1] << 16 | u8[2] << 8 | u8[3]) >>> 0;
  if (w === 0x80371240 || w === 0x37804012 || w === 0x40123780) add('n64');
  if (u8.length > 0x150 && u8[4] === 0x24 && u8[5] === 0xff && u8[6] === 0xae && u8[7] === 0x51) add('gba');
  if (u8.length > 0x150 && u8[0x104] === 0xce && u8[0x105] === 0xed && u8[0x106] === 0x66 && u8[0x107] === 0x66) add(u8[0x143] & 0x80 ? 'gbc' : 'gb');
  const sega = ascii(u8, 0x100, 16);
  if (/^SEGA 32X/.test(sega)) add('s32x'); else if (/^SEGA/.test(sega) && !/SEGA SATURN|SEGASATURN/.test(ascii(u8, 0, 32))) add('md');
  for (const off of [0x7ff0, 0x3ff0, 0x1ff0]) if (u8.length >= off + 16 && ascii(u8, off, 8) === 'TMR SEGA') { add((u8[off + 0x0f] >> 4) >= 5 ? 'gg' : 'sms'); break; }
  if (ascii(u8, 1, 9) === 'ATARI7800') add('a7800');
  if (ascii(u8, 0, 4) === 'LYNX') add('lynx');
  if (ascii(u8, 0, 8) === 'PS-X EXE') add('psx');
  const head = ascii(u8, 0, Math.min(u8.length, 0x10000));
  if (head.includes('SEGADISCSYSTEM') || head.includes('SEGA DISC')) add('scd');
  if (head.includes('SEGA SEGASATURN') || head.includes('SEGASATURN')) add('saturn');
  if (head.includes('PC Engine CD-ROM SYSTEM') || head.includes('PC Engine CD')) add('pcecd');
  if (head.includes('PC-FX:Hu_CD-ROM')) add('pcfx');
  if (head.includes('CD-RTOS') || head.includes('CD-I ')) add('cdi');
  if (head.includes('PLAYSTATION') && !head.includes('PSP GAME')) add('psx');
  if (head.includes('PSP GAME') || head.includes('PSP UMD')) add('psp');
  if (u8[0] === 0x01 && ascii(u8, 1, 5) === 'ZZZZZ') add('threedo');
  if (ascii(u8, 0, 4) === 'IWAD' || ascii(u8, 0, 4) === 'PWAD') add('doom');
  return out;
}

/** Order candidate systems: sniff matches first, then size heuristics for cartridge-sized .bin files. */
export function rank(cands, likely, size) {
  const small = size && size <= 0x100000;
  return [...cands].sort((a, b) => {
    const s = (k) => (likely.includes(k) ? 0 : small && ['a2600', 'a5200', 'a7800', 'coleco', 'sms', 'md', 'pce', 'vb', 'jaguar'].includes(k) ? 1 : !small && ['psx', 'scd', 'saturn', 'pcecd', 'threedo'].includes(k) ? 1 : 2);
    return s(a) - s(b);
  });
}

/**
 * Detects the system of a file (a Blob/File). Returns { system, candidates, likely, inner }:
 *  - `system` set  => confident (known extension, header match or a ZIP whose contents pin one system)
 *  - otherwise     => `candidates` (best first) is what the "Which system?" picker should offer (empty = all systems).
 */
export async function detect(file, { peek = true } = {}) {
  const name = file.name || '', ext = extOf(name);
  if (EXT_TO_SYSTEM[ext]) return { system: EXT_TO_SYSTEM[ext], candidates: [], likely: [] };
  let likely = [], inner = null;
  if (peek && file.size) {
    const head = new Uint8Array(await file.slice(0, 0x10000 + 16).arrayBuffer());
    if (ext === 'zip' || head[0] === 0x50 && head[1] === 0x4b) {
      inner = await zipNames(file);
      if (inner) {
        const exts = inner.filter((n) => !n.endsWith('/')).map(extOf);
        const hit = [...new Set(exts.map((e) => EXT_TO_SYSTEM[e]).filter(Boolean))];
        if (hit.length === 1) return { system: hit[0], candidates: [], likely: hit, inner };
        const disc = exts.find((e) => ['cue', 'iso', 'chd', 'ccd'].includes(e));
        if (disc) return { system: null, candidates: AMBIGUOUS[disc], likely: [], inner };
        const amb = exts.find((e) => ['tap', 'tzx', 'm3u', 'pbp'].includes(e));
        if (amb) return { system: null, candidates: AMBIGUOUS[amb], likely: [], inner };
        if (exts.some((e) => ['exe', 'com', 'bat'].includes(e))) likely = ['dos'];
        else if (exts.some((e) => ['adf', 'ipf', 'dms'].includes(e))) likely = ['amiga'];
      }
    } else if (ext !== 'zip') {
      likely = sniffHead(head);
      if (likely.length && (!AMBIGUOUS[ext] || AMBIGUOUS[ext].includes(likely[0]) || ['bin', 'rom', 'iso', 'img'].includes(ext))) {
        // header says what it is: trust it (cartridge headers are specific; disc strings too)
        if (likely.length === 1 || likely[0] !== 'psx' || ext !== 'bin') return { system: likely[0], candidates: [], likely };
      }
    }
  }
  const cands = AMBIGUOUS[ext] || [];
  return { system: null, candidates: cands.length ? rank(cands, likely, file.size) : [], likely, inner };
}

/** Extracts entries from a ZIP (stored or deflated) -> [{ name, data: Uint8Array }]. Used for BIOS packs uploaded as .zip. */
export async function unzipEntries(blob, want = () => true) {
  const tailLen = Math.min(blob.size, 66000), tail = new Uint8Array(await blob.slice(blob.size - tailLen).arrayBuffer());
  let i = tail.length - 22; while (i >= 0 && !(tail[i] === 0x50 && tail[i + 1] === 0x4b && tail[i + 2] === 5 && tail[i + 3] === 6)) i--;
  if (i < 0) return [];
  const dv = new DataView(tail.buffer, tail.byteOffset + i), n = dv.getUint16(10, true), size = dv.getUint32(12, true), off = dv.getUint32(16, true);
  const cd = new Uint8Array(await blob.slice(off, off + size).arrayBuffer()), cv = new DataView(cd.buffer), out = []; let p = 0;
  for (let k = 0; k < n && cv.getUint32(p, true) === 0x02014b50; k++) {
    const method = cv.getUint16(p + 10, true), csize = cv.getUint32(p + 20, true), nl = cv.getUint16(p + 28, true), el = cv.getUint16(p + 30, true), cl = cv.getUint16(p + 32, true), lho = cv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(cd.subarray(p + 46, p + 46 + nl)); p += 46 + nl + el + cl;
    if (name.endsWith('/') || !want(name)) continue;
    const lh = new DataView(await blob.slice(lho, lho + 30).arrayBuffer()), start = lho + 30 + lh.getUint16(26, true) + lh.getUint16(28, true);
    const raw = blob.slice(start, start + csize);
    let data;
    if (method === 0) data = new Uint8Array(await raw.arrayBuffer());
    else if (method === 8 && typeof DecompressionStream === 'function') data = new Uint8Array(await new Response(raw.stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
    else continue;
    out.push({ name: name.split('/').pop(), data });
  }
  return out;
}

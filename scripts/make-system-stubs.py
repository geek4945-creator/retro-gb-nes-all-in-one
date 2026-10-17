#!/usr/bin/env python3
"""Writes tiny ORIGINAL stub images (not games, no copyrighted data) for every supported system, only to check in automated tests that
each emulator core downloads, initialises and accepts (or cleanly rejects) a file. Usage: make-system-stubs.py OUTDIR
Writes OUTDIR/<system-key>.<ext> plus OUTDIR/manifest.json: { key: { file, ext, note } }."""
import json, os, struct, sys, zipfile
out = sys.argv[1]; os.makedirs(out, exist_ok=True)
man = {}
def put(key, name, data, note=''):
    open(os.path.join(out, name), 'wb').write(bytes(data)); man[key] = {'file': name, 'note': note}

def mkcd(sectors=40, mode2=True):
    """Raw 2352-byte-sector MODE2 image with an empty body, and its cue sheet."""
    return bytes(sectors * 2352)
def cue(binname): return f'FILE "{binname}" BINARY\n  TRACK 01 MODE2/2352\n    INDEX 01 00:00:00\n'.encode()
def bundle(key, base, binname, data, note=''):
    zp = os.path.join(out, base + '.zip')
    with zipfile.ZipFile(zp, 'w', zipfile.ZIP_STORED) as z:
        z.writestr(base + '.cue', cue(binname)); z.writestr(binname, data)
    man[key] = {'file': base + '.zip', 'note': note or 'cue+bin bundle (as the app builds it)'}

# ---- Nintendo (GB/NES/DS stubs come from make-test-rom.py)
import subprocess
here = os.path.dirname(os.path.abspath(__file__))
for key, name in (('gb', 'gb.gb'), ('nes', 'nes.nes'), ('nds', 'nds.nds')):
    subprocess.run([sys.executable, os.path.join(here, 'make-test-rom.py'), os.path.join(out, name)], check=True); man[key] = {'file': name, 'note': ''}
gbc = bytearray(open(os.path.join(out, 'gb.gb'), 'rb').read()); gbc[0x143] = 0x80
c = 0
for b in gbc[0x134:0x14D]: c = (c - b - 1) & 0xFF
gbc[0x14D] = c; put('gbc', 'gbc.gbc', gbc)
gba = bytearray(0x8000); gba[0:4] = struct.pack('<I', 0xEAFFFFFE); gba[4:8] = bytes([0x24, 0xFF, 0xAE, 0x51]); gba[0xA0:0xAC] = b'TESTROM'.ljust(12, b'\0'); gba[0xAC:0xB0] = b'ATST'; gba[0xB2] = 0x96
chk = 0
for b in gba[0xA0:0xBD]: chk = (chk - b) & 0xFF
gba[0xBD] = (chk - 0x19) & 0xFF; put('gba', 'gba.gba', gba)
snes = bytearray(0x8000); snes[0x7FC0:0x7FD5] = b'TEST ROM'.ljust(21); snes[0x7FD5] = 0x20; snes[0x7FD7] = 0x08; snes[0x7FD9] = 0x01
snes[0x7FDC:0x7FE0] = struct.pack('<HH', 0x0000, 0xFFFF); snes[0x7FFC:0x7FFE] = struct.pack('<H', 0x8000); snes[0:2] = bytes([0x80, 0xFE]); put('snes', 'snes.sfc', snes)

# ---- Sega 8-bit
sms = bytearray(0x8000); sms[0:3] = bytes([0xF3, 0x18, 0xFE]); sms[0x7FF0:0x7FF8] = b'TMR SEGA'; sms[0x7FFF] = 0x4C
put('sms', 'sms.sms', sms)
gg = bytearray(sms); gg[0x7FFF] = 0x6C; put('gg', 'gg.gg', gg)
put('sg1000', 'sg1000.sg', bytes([0xF3, 0x18, 0xFE]) + bytes(0x4000 - 3))
# ---- Mega Drive / 32X
md = bytearray(0x20000); md[0:4] = struct.pack('>I', 0xFF0000); md[4:8] = struct.pack('>I', 0x200)
md[0x100:0x110] = b'SEGA MEGA DRIVE '; md[0x120:0x130] = b'TEST ROM        '; md[0x1A0:0x1A8] = struct.pack('>II', 0, 0x1FFFF); md[0x1F0:0x1F3] = b'JUE'
md[0x200:0x202] = bytes([0x60, 0xFE])
put('md', 'md.md', md)
x32 = bytearray(md); x32[0x100:0x110] = b'SEGA 32X        '; put('s32x', 's32x.32x', x32)
# ---- Atari
a26 = bytearray([0xEA]) * 4096; a26[0:3] = bytes([0x4C, 0x00, 0xF0]); a26[0xFFC:0x1000] = bytes([0x00, 0xF0, 0x00, 0xF0]); put('a2600', 'a2600.a26', a26)
a52 = bytearray(0x4000); a52[0:3] = bytes([0x4C, 0x00, 0x40]); a52[0x3FFC:0x4000] = bytes([0x00, 0x40, 0x00, 0x40]); put('a5200', 'a5200.a52', a52, 'needs 5200.rom BIOS')
a78 = bytearray(128 + 0x4000); a78[0] = 1; a78[1:10] = b'ATARI7800'; a78[17:20] = b'TST'; a78[49:53] = struct.pack('>I', 0x4000); a78[53] = 1
a78[128:131] = bytes([0x4C, 0x00, 0xC0]); a78[128 + 0x3FFC:128 + 0x4000] = bytes([0x00, 0xC0, 0x00, 0xC0]); put('a7800', 'a7800.a78', a78)
lnx = bytearray(64 + 0x20000); lnx[0:4] = b'LYNX'; lnx[4:6] = struct.pack('<H', 512); lnx[8:10] = struct.pack('<H', 1); lnx[10:20] = b'TESTROM\0\0\0'; lnx[0x1A:0x2A] = b'TEST'.ljust(16, b'\0'); put('lynx', 'lynx.lnx', lnx)
put('jaguar', 'jaguar.j64', bytes(0x40000))
# ---- SNK / NEC / Bandai / Nintendo VB
ngp = bytearray(0x40000); ngp[0:28] = b'COPYRIGHT BY SNK CORPORATION'; ngp[0x1C:0x20] = struct.pack('<I', 0x200040); ngp[0x20:0x24] = b'\x01\x00\x01\x00'; ngp[0x24:0x30] = b'TESTROM'.ljust(12, b'\0'); ngp[0x23] = 0
ngp[0x40:0x43] = bytes([0x6B, 0xFE, 0x00]); put('ngp', 'ngp.ngp', ngp)
ngc = bytearray(ngp); ngc[0x23] = 0x10; put('ngpc', 'ngpc.ngc', ngc)
pce = bytearray(0x20000); pce[0:3] = bytes([0x4C, 0x00, 0xE0]); pce[0x1FFE:0x2000] = bytes([0x00, 0xE0]); put('pce', 'pce.pce', pce)   # bank 0 is mapped at $E000 on reset
ws = bytearray(0x20000); ws[-16:-11] = bytes([0xEA, 0x00, 0x00, 0x00, 0xF0]); ws[-9] = 0x42; ws[-6] = 0x00; ws[-4] = 0x01; ws[-1] = 0; ws[-7] = 0; ws[-8] = 0x00
put('ws', 'ws.ws', ws); wsc = bytearray(ws); wsc[-7] = 0x01; put('wsc', 'wsc.wsc', wsc)
put('vb', 'vb.vb', bytes(0x80000))
put('coleco', 'coleco.col', b'\x55\xaa' + bytes([0x00, 0x80, 0x00, 0x80, 0x00, 0x80, 0x00, 0x80, 0x00, 0x80]) + bytes(0x2000 - 12), 'needs colecovision.rom BIOS')
# ---- N64
n64 = bytearray(0x100000); n64[0:4] = bytes([0x80, 0x37, 0x12, 0x40]); n64[4:8] = struct.pack('>I', 0x0000000F); n64[8:12] = struct.pack('>I', 0x80000400); n64[0x20:0x34] = b'TESTROM'.ljust(20, b'\0'); n64[0x3B:0x3F] = b'NTST'; n64[0x3E] = ord('E'); put('n64', 'n64.z64', n64)
# ---- Computers (BASIC stubs that jump to themselves)
def prg(addr, sys_txt, jmp):
    return struct.pack('<H', addr) + struct.pack('<H', addr + 10) + struct.pack('<H', 10) + b'\x9e' + sys_txt.encode() + b'\x00\x00\x00' + bytes([0x4C]) + struct.pack('<H', jmp)
put('c64', 'c64.prg', prg(0x0801, '2061', 0x080D)); put('c128', 'c128.prg', prg(0x1C01, '7181', 0x1C0D)); put('vic20', 'vic20.prg', prg(0x1001, '4110', 0x100E))
put('pet', 'pet.prg', prg(0x0401, '1039', 0x040F)); put('plus4', 'plus4.prg', prg(0x1001, '4110', 0x100E))
put('amiga', 'amiga.adf', bytes(901120))
z80 = bytearray(30 + 49152); z80[6:8] = struct.pack('<H', 0x8000); z80[8:10] = struct.pack('<H', 0xFF00); z80[12] = 0; put('zx', 'zx.z80', z80)
put('zx81', 'zx81.p', bytes(256))
dsk = bytearray(b'MV - CPCEMU Disk-File\r\nDisk-Info\r\n'.ljust(0x100, b'\0')); dsk[0x30] = 40; dsk[0x31] = 1; dsk[0x32:0x34] = struct.pack('<H', 0x1300); dsk += bytes(0x1300)
put('cpc', 'cpc.dsk', dsk)
put('dos', 'dos.com', bytes([0xB8, 0x13, 0x00, 0xCD, 0x10, 0xEB, 0xFE]))
put('doom', 'doom.wad', b'PWAD' + struct.pack('<II', 0, 12))
# ---- Arcade (junk ROM sets: the core must load and reject cleanly)
for key in ('arcade', 'mame', 'neogeo'):
    zp = os.path.join(out, key + 'game.zip')
    with zipfile.ZipFile(zp, 'w', zipfile.ZIP_STORED) as z: z.writestr(key + 'game.rom', bytes(1024))
    man[key] = {'file': key + 'game.zip', 'note': 'junk romset'}
# ---- Disc based
cd = mkcd(); 
for key, binname in (('psx', 'psx.bin'), ('scd', 'scd.bin'), ('saturn', 'saturn.bin'), ('threedo', 'threedo.bin'), ('pcecd', 'pcecd.bin'), ('pcfx', 'pcfx.bin'), ('cdi', 'cdi.bin')):
    bundle(key, key, binname, cd)
iso = bytearray(0x10000 + 0x8000); iso[0x8000:0x8006] = b'\x01CD001'; iso[0x8008:0x8020] = b'PSP GAME'.ljust(24)
put('psp', 'psp.iso', iso)
json.dump(man, open(os.path.join(out, 'manifest.json'), 'w'), indent=1)
print(len(man), 'stubs written to', out)

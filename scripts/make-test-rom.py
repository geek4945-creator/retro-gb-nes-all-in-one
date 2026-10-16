#!/usr/bin/env python3
"""Writes a tiny original test ROM (Game Boy by default, NES with a .nes output name) (turns the LCD on and idles) for automated tests.
Not a game — just enough for the emulator core to boot. Usage: make-test-rom.py OUT.gb"""
import sys
logo = bytes.fromhex('CEED6666CC0D000B03730083000C000D0008111F8889000EDCCC6EE6DDDDD999BBBB67636E0EECCCDDDC999FBBB9333E')
rom = bytearray(0x8000)
rom[0x100:0x104] = bytes([0x00, 0xC3, 0x50, 0x01])        # nop; jp 0x0150
rom[0x104:0x134] = logo
rom[0x134:0x13E] = b'TESTROM'.ljust(10, b'\0')
rom[0x147] = 0x00; rom[0x148] = 0x00; rom[0x149] = 0x00   # ROM only, 32 KB, no RAM
c = 0
for b in rom[0x134:0x14D]: c = (c - b - 1) & 0xFF
rom[0x14D] = c
rom[0x150:0x156] = bytes([0x3E, 0x91, 0xE0, 0x40, 0x18, 0xFE])  # ld a,0x91; ldh (0x40),a; jr -2
if sys.argv[1].endswith('.nes'):   # minimal iNES: 16 KB PRG, reset vector -> $8000, `jmp $8000` loop
    prg = bytearray(0x4000); prg[0:3] = bytes([0x4C, 0x00, 0x80]); prg[0x3FFC:0x3FFE] = bytes([0x00, 0x80])
    rom = bytearray(b'NES\x1a' + bytes([1, 0, 0, 0]) + bytes(8)) + prg
open(sys.argv[1], 'wb').write(rom)

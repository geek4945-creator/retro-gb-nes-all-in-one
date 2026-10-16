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
if sys.argv[1].endswith('.nes'):
    # Minimal iNES (mapper 0, 16 KB PRG, 8 KB CHR, battery-backed PRG-RAM so save flushes have work to do).
    # Program: enable APU pulse 1 (audible tone), write PRG-RAM and toggle the PPU mask forever.
    code = bytes([
        0x78, 0xD8, 0xA2, 0xFF, 0x9A,                  # sei; cld; ldx #$ff; txs
        0xA9, 0x01, 0x8D, 0x15, 0x40,                  # lda #1; sta $4015
        0xA9, 0x9F, 0x8D, 0x00, 0x40,                  # lda #$9f; sta $4000
        0xA9, 0xFF, 0x8D, 0x02, 0x40,                  # lda #$ff; sta $4002
        0xA9, 0x08, 0x8D, 0x03, 0x40,                  # lda #8; sta $4003
        0xE6, 0x00, 0xA5, 0x00,                        # loop: inc $00; lda $00
        0x8D, 0x00, 0x60,                              # sta $6000 (battery RAM)
        0x8D, 0x01, 0x20,                              # sta $2001 (PPU mask)
        0x4C, 0x19, 0x80,                              # jmp loop
    ])
    prg = bytearray(0x4000); prg[:len(code)] = code; prg[0x3FFC:0x3FFE] = bytes([0x00, 0x80])
    rom = bytearray(b'NES\x1a' + bytes([1, 1, 0x02, 0]) + bytes(8)) + prg + bytearray(0x2000)
elif sys.argv[1].endswith('.nds'):
    # NOT a real game: a zero-filled 128 KB image with a plausible NDS header, only to check that the core loads.
    rom = bytearray(0x20000); rom[0:12] = b'TESTROM\0\0\0\0\0'; rom[0x0C:0x10] = b'ATST'; rom[0x12] = 0
    rom[0x20:0x24] = (0x4000).to_bytes(4, 'little'); rom[0x24:0x28] = (0x2000000).to_bytes(4, 'little')
    rom[0x28:0x2C] = (0x2000000).to_bytes(4, 'little'); rom[0x2C:0x30] = (0x200).to_bytes(4, 'little')
    rom[0x80:0x84] = (0x20000).to_bytes(4, 'little'); rom[0x84:0x88] = (0x4000).to_bytes(4, 'little')
open(sys.argv[1], 'wb').write(rom)

#!/usr/bin/env python3
"""Writes an original DS *test program* (not a game) that lets automated tests observe what the emulated touchscreen receives.
 ARM9: top screen = red backdrop, bottom screen = blue backdrop (so the screen layout is visible in screenshots).
 ARM7: polls the pen (REG_KEYXY bit 6) and reads the touch panel over SPI exactly like libnds' touchRead(), then stores
       { magic 0xC0FFEE42, pen_down, adc_x(12 bit), adc_y(12 bit), counter, KEYINPUT (0x130, active-low A B Sel Start R L U D ...), KEYXY (0x136) } at main-RAM 0x02300000 (little endian words).
       DeSmuME / melonDS report pixel = adc >> 4, so (adc_x >> 4, adc_y >> 4) is the touch point in 0..255 x 0..191.
The machine code was assembled once with keystone (ARM mode); the source is kept below for reference. Usage: make-ds-touch-rom.py OUT.nds"""
import sys
ARM9 = bytes.fromhex('0244a0e3034684e3ab10a0e3201084e50103a0e3032c80e2821ca0e3031081e3b410c2e10118a0e3001080e5012a80e2001082e50534a0e31f10a0e3b010c3e1013b83e21f1ba0e3b010c3e1cd10a0e3241084e5feffffea')
ARM7 = bytes.fromhex('0e05a0e3ffdc80e30193a0e3019c89e2369089e20183a0e3078d88e20254a0e3035685e3d0609fe5006085e50070a0e3b010d9e1400011e30a00001a9000a0e3110000eb00a0a0e1d000a0e30e0000eb00b0a0e10110a0e3041085e508b085e50ca085e5010000ea0010a0e3041085e5017087e2107085e5b61059e1141085e5b010d9e1181085e5e8ffffea1e402de90219a0e30a1c81e3011081e3b010c8e1b200c8e1100000eb0020a0e3b220c8e10d0000ebb230d8e10219a0e3021c81e3011081e3b010c8e10020a0e3b220c8e1050000ebb240d8e17f3003e28332a0e1a40183e11e40bde80ef0a0e1b020d8e1800012e3fcffff1a0ef0a0e142eeffc0')
# --- ARM9 source (loaded at 0x02000000): POWCNT1 = LCD|2D-A|2D-B|top=A; DISPCNT A/B = graphics display (no BGs); palette[0] A = red, B = blue; loop
# --- ARM7 source (loaded at 0x02380000): set sp; r9=REG_KEYXY(0x04000136) r8=REG_SPICNT(0x040001C0) r5=0x02300000; loop { if pen down:
# ---   y = touchread(0x90); x = touchread(0xD0); store down/x/y } ; counter++ ; touchread = SPICNT=0x8A01(hold CS); SPIDATA=cmd; wait; SPIDATA=0; wait;
# ---   hi=SPIDATA; SPICNT=0x8201; SPIDATA=0; wait; lo=SPIDATA; return ((hi&0x7f)<<5)|(lo>>3)
rom = bytearray(0x20000)
rom[0:12] = b'TOUCHPROBE\0\0'; rom[0x0C:0x10] = b'ATPR'; rom[0x12] = 0
def w(off, v): rom[off:off + 4] = v.to_bytes(4, 'little')
w(0x20, 0x4000); w(0x24, 0x02000000); w(0x28, 0x02000000); w(0x2C, 0x200)     # ARM9: rom offset, entry, ram address, size
w(0x30, 0x4200); w(0x34, 0x02380000); w(0x38, 0x02380000); w(0x3C, 0x200)     # ARM7
w(0x80, 0x20000); w(0x84, 0x4000)
rom[0x4000:0x4000 + len(ARM9)] = ARM9; assert len(ARM7) <= 0x200
rom[0x4200:0x4200 + len(ARM7)] = ARM7
open(sys.argv[1], 'wb').write(rom)

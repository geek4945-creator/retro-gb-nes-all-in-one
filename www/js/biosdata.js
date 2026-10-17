// What the BIOS dialog can offer to download, and where to read more. ONLY files whose licence allows redistribution are listed here.
// Every entry is mirrored inside this repository (www/bios-open/, with the licence text next to it) so a download is a same-origin fetch:
// no CORS problem, works offline once cached, and never touches a third-party site at runtime.
// scripts/check.mjs verifies each file's size + md5 against this table.
//
// NOT listed (and never will be): any commercial BIOS / firmware (Sony, Sega, Nintendo, Atari, SNK, NEC, Panasonic, Coleco, Commodore...).
// libretro's own "Download Core System Files" pack does not contain those either - only open per-core assets - and its host
// (buildbot.libretro.com) sends no CORS headers, so a web page could not fetch it anyway.

export const OPEN_FILES = [
  {
    system: 'gba', name: 'gba_bios.bin', size: 16384, md5: 'e2a18f17249a24415ca70d57f40501c8', url: 'bios-open/gba_bios.bin',
    label: 'Cult of GBA open-source BIOS', license: 'MIT', licenseUrl: 'bios-open/licenses/Cult-of-GBA-BIOS.MIT.txt',
    source: 'https://github.com/Cult-of-GBA/BIOS', sourceRev: 'a30e9a96df08',
    note: 'A from-scratch, MIT-licensed GBA BIOS (written by DenSinH & fleroviux). Not byte-identical to Nintendo\'s, so the md5 differs from the official one; mGBA accepts it.',
  },
  {
    system: 'gb', name: 'gb_bios.bin', size: 256, md5: '6344d08bbbcbedbbaef9ddbdf7632c74', url: 'bios-open/gb_bios.bin',
    label: 'SameBoy DMG boot ROM', license: 'Expat (MIT)', licenseUrl: 'bios-open/licenses/SameBoy.Expat.txt',
    source: 'https://github.com/LIJI32/SameBoy', sourceRev: 'v1.0.4 (dmg_boot.bin)',
    note: 'Open-source replacement boot ROM (SameBoy logo animation instead of Nintendo\'s). Used by Gambatte when "Use official bootloader" is on. mGBA only accepts the original boot ROMs and ignores it.',
  },
  {
    system: 'gbc', name: 'gbc_bios.bin', size: 2304, md5: '62cfda90d22405cdff59700c388a57f6', url: 'bios-open/gbc_bios.bin',
    label: 'SameBoy CGB boot ROM', license: 'Expat (MIT)', licenseUrl: 'bios-open/licenses/SameBoy.Expat.txt',
    source: 'https://github.com/LIJI32/SameBoy', sourceRev: 'v1.0.4 (cgb_boot.bin)',
    note: 'Open-source replacement boot ROM (SameBoy animation, colourises DMG games like a real CGB). Used by Gambatte; mGBA ignores it.',
  },
];

/** Systems that already ship a free, built-in BIOS replacement inside their core: nothing to download. */
export const BUILTIN = {
  gba: 'mGBA has a built-in open BIOS replacement, so games run without any file.',
  nds: 'melonDS (FreeBIOS) and DeSmuME 2015 run without BIOS/firmware files using a built-in open replacement.',
  a5200: 'The Atari 5200 core contains the open-source AltirraOS replacement, so it needs no file.',
  amiga: 'PUAE contains the open-source AROS Kickstart replacement. Retro Pocket selects it automatically while you have no real Kickstart stored.',
  psx: 'PCSX ReARMed has a built-in HLE BIOS (many games run without a file; accuracy is better with a real BIOS).',
  saturn: 'Yabause has a built-in HLE BIOS (works for some games only).',
};

/** libretro docs page per BIOS system (verified to exist). */
export const DOCS = {
  gb: 'gambatte', gbc: 'gambatte', gba: 'mgba', nes: 'nestopia', nds: 'melonds', psx: 'pcsx_rearmed', scd: 'genesis_plus_gx',
  saturn: 'yabause', a5200: 'a5200', a7800: 'prosystem', lynx: 'handy', neogeo: 'fbneo', pcecd: 'beetle_pce_fast', pcfx: 'beetle_pc_fx',
  threedo: 'opera', coleco: 'gearcoleco', cdi: 'same_cdi', amiga: 'puae',
};
export const DOCS_ROOT = 'https://docs.libretro.com/library/';
export const BIOS_DOCS = 'https://docs.libretro.com/library/bios/';
export const docsUrl = (system) => (DOCS[system] ? `${DOCS_ROOT}${DOCS[system]}/` : BIOS_DOCS);

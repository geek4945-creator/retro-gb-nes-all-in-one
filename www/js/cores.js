// Systems, file extensions and EmulatorJS (RetroArch/libretro) core mapping.
export const SYSTEMS = {
  gb:   { label: 'Game Boy',        short: 'GB',   color: '#8bac0f', cores: ['gambatte', 'mgba'] },
  gbc:  { label: 'Game Boy Color',  short: 'GBC',  color: '#a05cff', cores: ['gambatte', 'mgba'] },
  gba:  { label: 'Game Boy Advance',short: 'GBA',  color: '#4f7cff', cores: ['mgba'] },
  nes:  { label: 'NES',             short: 'NES',  color: '#e0405a', cores: ['fceumm', 'nestopia'] },
  snes: { label: 'SNES',            short: 'SNES', color: '#f0a030', cores: ['snes9x'] },
  nds:  { label: 'Nintendo DS',     short: 'DS',   color: '#2fb6c9', cores: ['desmume2015', 'melonds'] },
};

export const EXT_TO_SYSTEM = {
  gb: 'gb', gbc: 'gbc', cgb: 'gbc', sgb: 'gb',
  gba: 'gba',
  nes: 'nes', fds: 'nes', unf: 'nes', unif: 'nes',
  sfc: 'snes', smc: 'snes', swc: 'snes', fig: 'snes',
  nds: 'nds',
};

export const CORE_LABELS = {
  gambatte: 'Gambatte (accurate GB/GBC)',
  mgba: 'mGBA (GB/GBC/GBA)',
  fceumm: 'FCEUmm (fast NES)',
  nestopia: 'Nestopia (accurate NES)',
  snes9x: 'Snes9x (SNES)',
  desmume2015: 'DeSmuME 2015 (faster, best for phones)',
  melonds: 'melonDS (more accurate, heavier)',
};

// Pinned EmulatorJS release (loader, UI and cores all come from this one version, so a CDN "stable" bump can never mismatch).
export const EJS_VERSION = '4.2.3';
export const EJS_CDN = `https://cdn.emulatorjs.org/${EJS_VERSION}/data/`;

export const DEFAULT_SETTINGS = { gbCore: 'gambatte', nesCore: 'nestopia', dsCore: 'desmume2015', autoResume: true, v: 2 };

/** The other core of a system (used for crash fallback), or null when there is only one. */
export function altCore(system, core) {
  const list = (SYSTEMS[system] || {}).cores || [];
  return list.find((c) => c !== core) || null;
}

export function extOf(name) {
  const m = /\.([^.\/\\]+)$/.exec(name || '');
  return m ? m[1].toLowerCase() : '';
}
export function systemFor(name) { return EXT_TO_SYSTEM[extOf(name)] || null; }
export function titleFrom(name) {
  return (name || 'Untitled').replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ')
    .replace(/\s*[\(\[][^\)\]]*[\)\]]/g, '').replace(/\s+/g, ' ').trim() || name;
}
export function defaultCore(system, settings = DEFAULT_SETTINGS) {
  if (system === 'gba') return 'mgba';
  if (system === 'gb' || system === 'gbc') return settings.gbCore || 'gambatte';
  if (system === 'nes') return settings.nesCore || 'nestopia';
  if (system === 'nds') return settings.dsCore || 'desmume2015';
  return 'snes9x';
}
export function loadSettings() {
  try {
    const s = { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem('rp.settings') || '{}') };
    if (!s.v || s.v < 2) { s.nesCore = 'nestopia'; s.v = 2; saveSettings(s); }   // v2: NES default moved to Nestopia (more stable)
    return s;
  } catch { return { ...DEFAULT_SETTINGS }; }
}
export function saveSettings(s) { localStorage.setItem('rp.settings', JSON.stringify(s)); }

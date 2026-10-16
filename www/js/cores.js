// Systems, file extensions and EmulatorJS (RetroArch/libretro) core mapping.
export const SYSTEMS = {
  gb:   { label: 'Game Boy',        short: 'GB',   color: '#8bac0f', cores: ['gambatte', 'mgba'] },
  gbc:  { label: 'Game Boy Color',  short: 'GBC',  color: '#a05cff', cores: ['gambatte', 'mgba'] },
  gba:  { label: 'Game Boy Advance',short: 'GBA',  color: '#4f7cff', cores: ['mgba'] },
  nes:  { label: 'NES',             short: 'NES',  color: '#e0405a', cores: ['fceumm', 'nestopia'] },
  snes: { label: 'SNES',            short: 'SNES', color: '#f0a030', cores: ['snes9x'] },
};

export const EXT_TO_SYSTEM = {
  gb: 'gb', gbc: 'gbc', cgb: 'gbc', sgb: 'gb',
  gba: 'gba',
  nes: 'nes', fds: 'nes', unf: 'nes', unif: 'nes',
  sfc: 'snes', smc: 'snes', swc: 'snes', fig: 'snes',
};

export const CORE_LABELS = {
  gambatte: 'Gambatte (accurate GB/GBC)',
  mgba: 'mGBA (GB/GBC/GBA)',
  fceumm: 'FCEUmm (fast NES)',
  nestopia: 'Nestopia (accurate NES)',
  snes9x: 'Snes9x (SNES)',
};

export const DEFAULT_SETTINGS = { gbCore: 'gambatte', nesCore: 'fceumm', autoResume: true };

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
  if (system === 'nes') return settings.nesCore || 'fceumm';
  return 'snes9x';
}
export function loadSettings() {
  try { return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem('rp.settings') || '{}') }; }
  catch { return { ...DEFAULT_SETTINGS }; }
}
export function saveSettings(s) { localStorage.setItem('rp.settings', JSON.stringify(s)); }

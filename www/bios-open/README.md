# Open-licensed BIOS replacements

Only files whose licence allows redistribution are mirrored here (so the app can offer them from Settings → BIOS files with one tap).
**No commercial BIOS or firmware is, or will be, stored in this repository.**

| File | What | Licence | Upstream |
|---|---|---|---|
| `gba_bios.bin` | Cult of GBA open-source GBA BIOS (16384 bytes) | MIT - `licenses/Cult-of-GBA-BIOS.MIT.txt` | https://github.com/Cult-of-GBA/BIOS (commit a30e9a96df08, file `bios.bin`) |
| `gb_bios.bin` | SameBoy DMG boot ROM (`dmg_boot.bin`, 256 bytes) | Expat/MIT - `licenses/SameBoy.Expat.txt` | https://github.com/LIJI32/SameBoy release v1.0.4 (`sameboy_winsdl_v1.0.4.zip`, sha256 `777a2921…d5a38`) |
| `gbc_bios.bin` | SameBoy CGB boot ROM (`cgb_boot.bin`, 2304 bytes) | Expat/MIT - `licenses/SameBoy.Expat.txt` | same release |

Sizes and md5 sums are recorded in `www/js/biosdata.js` and verified by `npm run check`.
The core-built-in replacements (mGBA, melonDS FreeBIOS, AltirraOS in the 5200 core, AROS in PUAE) need no file.

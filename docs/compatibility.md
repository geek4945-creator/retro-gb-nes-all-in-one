# Emulation compatibility review (Oct 2026)

## EmulatorJS version: staying on 4.2.3 (latest stable)

| Release | Status | Notes |
|---|---|---|
| **4.2.3** (Jul 2025) | latest **stable**, used by Retro Pocket | All suites + boot matrix pass |
| 4.3.0-pre (May 2026) | **pre-release**, upstream says "not advised" for production; "cores are not inter-changeable between versions" | Adds bsnes, FreeIntv (Intellivision), Azahar (3DS, threaded), Genesis Plus GX Wide, WebRTC netplay; moves to ES modules and rewrites save-state reading, start detection, cache, download |

Boot matrix against 4.3.0-pre, same stubs and player (`EJS_DATA=https://cdn.emulatorjs.org/4.3.0-pre/data/ ALT=1 node tests/systems.mjs`):

| System / core | 4.2.3 | 4.3.0-pre |
|---|---|---|
| NES nestopia / fceumm, SNES, GB, GBA, DS desmume2015 / melonDS, PS1 both cores, MD, Saturn, Arcade (FBNeo, CPS1/2), DOS | BOOT | BOOT |
| N64 parallel_n64 | BOOT | **REJECTED** (fails to start) |
| N64 mupen64plus_next | aborts on stub → auto fallback to parallel_n64 boots | aborts, and the fallback now fails too |
| PSP ppsspp (threaded) | BOOT | **FAIL** (timeout, never starts) |

**Decision:** the upgrade is not safe yet. It regresses N64 (and with it our crash fallback) and PSP, and it changes the save-state path that auto-resume, crash recovery and cloud sync depend on.
Retro Pocket pins `EJS_VERSION = '4.2.3'` in `www/js/cores.js`. When a stable 4.3.x ships, re-run the matrix with `EJS_DATA=` before bumping.

## Default cores (unchanged; reasons)

| System | Default → alternate | Why |
|---|---|---|
| GBA | mGBA | gpSP is not built/hosted by EmulatorJS (no `gpsp-wasm.data` on the CDN for 4.2.3 or 4.3.0-pre) |
| DS | DeSmuME 2015 → melonDS | DeSmuME 2015 is the lighter core on phones. melonDS is more accurate but heavier. DS touch and screen layouts are tuned and tested for both |
| N64 | Mupen64Plus-Next → ParaLLEl | Mupen is faster/more compatible with GLideN64. If it aborts early, the player automatically falls back to ParaLLEl |
| PS1 | PCSX ReARMed → Beetle PSX HW | ReARMed is far lighter on phones. Beetle is more accurate but needs real BIOS and more CPU |
| Mega Drive | Genesis Plus GX → PicoDrive | GPGX is the accurate default. PicoDrive covers 32X |
| SNES | Snes9x | bsnes only exists in 4.3.0-pre |

You can switch the core per game from the game sheet in the library (tap ⋯ → Core).

## New systems evaluated

| System | Result | Reason |
|---|---|---|
| Dreamcast (Flycast), GameCube/Wii (Dolphin), PS2 (Play!) | not feasible | No WebAssembly core in EmulatorJS 4.2.3 or 4.3.0-pre |
| 3DS (Azahar) | not added | Only in 4.3.0-pre (threaded build). Cores can't be mixed across EmulatorJS versions, and it is far too heavy for phones |
| Intellivision (FreeIntv) | not added | Only in 4.3.0-pre. It also needs the copyrighted exec.bin/grom.bin BIOS |
| Saturn | already supported | Yabause, boots |
| Odyssey², Vectrex, Pokémon Mini, MSX, Neo Geo CD | not feasible | No o2em / vecx / pokemini / blueMSX / fMSX / NeoCD core on the EmulatorJS CDN (checked all `-wasm`, `-legacy`, `-thread` builds) |

# Retro Pocket — 46 retro systems in one app (Game Boy → PlayStation, N64, PSP, Sega, Atari, arcade, DOS…)

An all-in-one retro emulator that runs **in the browser** (installable on iPhone from Safari as a Home Screen app) and as an **Android APK**. It does *not* need RetroArch installed: it embeds [EmulatorJS](https://github.com/EmulatorJS/EmulatorJS), which ships the RetroArch/libretro cores compiled to WebAssembly.

<!-- systems:start -->
| System | Add as | Default core (alternates) | BIOS | Notes |
|---|---|---|---|---|
| **Game Boy** (Nintendo) | `.gb` `.dmg` `.sgb` | `gambatte` (`mgba`) | gb_bios.bin optional, dmg_boot.bin optional | 1P |
| **Game Boy Color** (Nintendo) | `.gbc` `.cgb` | `gambatte` (`mgba`) | gbc_bios.bin optional | 1P |
| **Game Boy Advance** (Nintendo) | `.gba` | `mgba` | gba_bios.bin optional | 1P |
| **NES / Famicom** (Nintendo) | `.nes` `.unf` `.unif` `.fds` | `nestopia` (`fceumm`) | disksys.rom recommended | 2P |
| **SNES / Super Famicom** (Nintendo) | `.sfc` `.smc` `.swc` `.fig` `.bs` `.st` | `snes9x` | none | 2P |
| **Nintendo 64** (Nintendo) | `.n64` `.v64` `.z64` `.ndd` `.bin` *(asks which system)* | `mupen64plus_next` (`parallel_n64`) | none | ⚠ heavy · analog · 4P · Z = L2/ZL, C-buttons = right stick, analog stick = left stick. |
| **Nintendo DS** (Nintendo) | `.nds` | `desmume2015` (`melonds`) | bios7.bin optional, bios9.bin optional, firmware.bin optional | 1P |
| **Virtual Boy** (Nintendo) | `.vb` `.vboy` `.bin` *(asks which system)* | `beetle_vb` | none | 1P |
| **PlayStation** (Sony) | `.mdf` `.toc` `.cbn` `.bin` `.iso` `.cue` `.chd` `.ccd` `.m3u` … *(asks which system)* | `pcsx_rearmed` (`mednafen_psx_hw`) | scph5501.bin recommended, scph5500.bin recommended, scph5502.bin recommended, scph1001.bin optional | ⚠ heavy · analog · 2P · Multi-disc games: add a .m3u playlist or one .cue per disc. L2/R2 = triggers, analog sticks supported. |
| **PlayStation Portable** (Sony) | `.cso` `.prx` `.elf` `.iso` `.chd` `.pbp` *(asks which system)* | `ppsspp` | none | ⚠ heavy · analog · 1P · Needs threads + WebGL2 (the app turns on cross-origin isolation automatically). |
| **Master System** (Sega) | `.sms` `.bin` `.rom` *(asks which system)* | `smsplus` (`genesis_plus_gx`, `picodrive`) | none | 2P |
| **Game Gear** (Sega) | `.gg` | `genesis_plus_gx` (`smsplus`) | none | 1P |
| **SG-1000** (Sega) | `.sg` | `genesis_plus_gx` (`smsplus`) | none | 2P |
| **Genesis / Mega Drive** (Sega) | `.md` `.smd` `.gen` `.mdx` `.68k` `.sgd` `.bms` `.bin` `.iso` `.cue` *(asks which system)* | `genesis_plus_gx` (`picodrive`) | none | 2P |
| **Sega CD / Mega-CD** (Sega) | `.bin` `.iso` `.cue` `.chd` `.m3u` *(asks which system)* | `genesis_plus_gx` (`picodrive`) | bios_CD_U.bin **required**, bios_CD_E.bin **required**, bios_CD_J.bin **required** | 2P |
| **Sega 32X** (Sega) | `.32x` | `picodrive` | none | 2P |
| **Sega Saturn** (Sega) | `.mds` `.bin` `.iso` `.cue` `.chd` `.ccd` `.m3u` … *(asks which system)* | `yabause` | saturn_bios.bin recommended | ⚠ heavy · 2P · Digital pad: A/B/C = ✕/○/□-style face buttons, X/Y/Z = Y/X + R. Saturn emulation is very heavy. |
| **Atari 2600** (Atari) | `.a26` `.bin` `.zip` *(asks which system)* | `stella2014` | none | 2P · Select = Game Select, Start = Reset. |
| **Atari 5200** (Atari) | `.a52` `.bin` `.rom` *(asks which system)* | `a5200` | 5200.rom **required** | 2P |
| **Atari 7800** (Atari) | `.a78` `.bin` `.rom` *(asks which system)* | `prosystem` | 7800 BIOS (U).rom optional, 7800 BIOS (E).rom optional | 2P |
| **Atari Lynx** (Atari) | `.lnx` | `handy` | lynxboot.img recommended | 1P |
| **Atari Jaguar** (Atari) | `.j64` `.jag` `.abs` `.cof` `.bin` `.rom` *(asks which system)* | `virtualjaguar` | none | 2P |
| **Neo Geo Pocket** (SNK) | `.ngp` | `mednafen_ngp` | none | 1P |
| **Neo Geo Pocket Color** (SNK) | `.ngc` | `mednafen_ngp` | none | 1P |
| **Neo Geo (AES/MVS)** (SNK) | `.zip` `.7z` *(asks which system)* | `fbneo` | neogeo.zip **required** | 2P · Select = Coin, Start = Start. Games are the usual FBNeo/MAME .zip sets. |
| **PC Engine / TurboGrafx-16** (NEC) | `.pce` `.bin` *(asks which system)* | `mednafen_pce` | none | 2P |
| **PC Engine CD / TurboGrafx-CD** (NEC) | `.bin` `.iso` `.cue` `.chd` `.ccd` `.m3u` … *(asks which system)* | `mednafen_pce` | syscard3.pce **required** | 2P |
| **PC-FX** (NEC) | `.iso` `.cue` `.chd` `.ccd` *(asks which system)* | `mednafen_pcfx` | pcfx.rom **required** | 2P |
| **WonderSwan** (Bandai) | `.ws` `.pc2` | `mednafen_wswan` | none | 1P |
| **WonderSwan Color** (Bandai) | `.wsc` | `mednafen_wswan` | none | 1P |
| **3DO** (Other) | `.bin` `.iso` `.cue` `.chd` *(asks which system)* | `opera` | panafz10.bin **required**, panafz1.bin optional, goldstar.bin optional, sanyotry.bin optional | ⚠ heavy · 2P |
| **ColecoVision** (Other) | `.col` `.cv` `.bin` `.rom` *(asks which system)* | `gearcoleco` | colecovision.rom **required** | 2P |
| **Philips CD-i** (Other) | `.iso` `.cue` `.chd` *(asks which system)* | `same_cdi` | cdimono1.zip **required** | ⚠ heavy · 1P · experimental |
| **Commodore 64** (Computers) | `.d64` `.d71` `.d81` `.t64` `.prg` `.p00` `.crt` … `.m3u` `.gz` `.tap` *(asks which system)* | `vice_x64sc` (`vice_x64`) | none | 2P · Joystick only on mobile; a physical keyboard works on desktop. Auto-starts disks/tapes. |
| **Commodore 128** (Computers) | — | `vice_x128` | none | 2P · experimental |
| **Commodore VIC-20** (Computers) | — | `vice_xvic` | none | 2P |
| **Commodore PET** (Computers) | — | `vice_xpet` | none | 1P · experimental |
| **Commodore Plus/4** (Computers) | — | `vice_xplus4` | none | 2P |
| **Commodore Amiga** (Computers) | `.adf` `.adz` `.dms` `.fdi` `.ipf` `.hdf` `.hdz` … `.iso` `.cue` `.chd` `.ccd` `.m3u` `.zip` … *(asks which system)* | `puae` | kick34005.A500 recommended, kick37175.A500 recommended, kick40063.A600 recommended, kick40068.A1200 optional | 2P · Mouse/keyboard-centric: joystick games work best. Keyboard on desktop. |
| **ZX Spectrum** (Computers) | `.z80` `.rzx` `.scl` `.trd` `.tap` `.tzx` *(asks which system)* | `fuse` | none | 1P · experimental |
| **ZX81** (Computers) | `.t81` `.p` `.tzx` *(asks which system)* | `81` | none | 1P · experimental |
| **Amstrad CPC** (Computers) | `.dsk` `.sna` `.cdt` `.cpr` `.kcr` `.m3u` `.zip` `.tap` *(asks which system)* | `cap32` (`crocods`) | none | 1P · experimental |
| **DOS** (Computers) | `.conf` `.com` `.bat` `.dosz` `.iso` `.exe` `.zip` `.7z` *(asks which system)* | `dosbox_pure` | none | ⚠ heavy · 1P · experimental · Add a game as a .zip (a DOS game folder zipped) or a single .exe/.com/.bat. Needs threads (enabled automatically). |
| **Doom (PrBoom)** (Computers) | `.wad` `.iwad` `.pwad` | `prboom` | none | 1P · experimental · Add your own IWAD (doom.wad, doom2.wad, freedoom…). Not included. |
| **Arcade (FinalBurn Neo)** (Arcade) | `.zip` `.7z` *(asks which system)* | `fbneo` (`fbalpha2012_cps1`, `fbalpha2012_cps2`) | shares Neo Geo (AES/MVS) BIOS (optional) | 4P · Select = Coin, Start = Start. Use the exact ROM-set .zip for FBNeo (needs matching version of the set). |
| **Arcade (MAME 2003+)** (Arcade) | `.zip` `.7z` *(asks which system)* | `mame2003_plus` (`mame2003`) | shares Neo Geo (AES/MVS) BIOS (optional) | 4P · Select = Coin, Start = Start. Use ROM sets matching MAME 0.78 / 2003-Plus. |
<!-- systems:end -->

Features: **46 systems** (table above, verified against the pinned EmulatorJS 4.2.3 core list), content-based system detection with a *Which system?* picker for ambiguous files, `.cue`+`.bin` disc bundling, per-system **BIOS upload** (stored on your device, never bundled), performance warnings, **Bluetooth/USB controller support**, automatic **box art** (+ a *Change cover* picker with web search, URL paste and upload), crash protection with automatic core fallback, ROM library saved on your device (IndexedDB), add many ROMs at once, search + system filters, auto-detected core per file, on-screen touch gamepad, save states, battery saves (flushed every 30 s), **auto-resume** (your session is snapshotted when you leave a game), dark mobile-first UI, offline shell via service worker.

## ⚖️ Legal

* **Bring your own ROMs.** No games or BIOS files are included or downloaded. Only use dumps of cartridges you own, or homebrew you have the right to play. The ROMs you add never leave your device (they're stored in the browser's local database).
* **Licensing:** this project is released under **GPL-3.0** (see `LICENSE`). It loads [EmulatorJS](https://github.com/EmulatorJS/EmulatorJS) (GPL-3.0) and the RetroArch/libretro cores (Gambatte GPL-2.0, mGBA MPL-2.0, FCEUmm/Nestopia GPL-2.0, DeSmuME GPL-2.0, melonDS GPL-3.0, Mupen64Plus-Next GPL-2.0, PCSX ReARMed GPL-2.0, PPSSPP GPL-2.0, Genesis Plus GX / SMS Plus **non-commercial** licences, Snes9x **non-commercial**, Stella GPL-2.0, MAME 2003 / FBNeo **non-commercial**, VICE GPL-2.0, DOSBox Pure GPL-2.0 …) from the EmulatorJS CDN at runtime. Several cores forbid commercial use, so do not sell this app or publish it commercially; check each core's licence if you redistribute. Apple's App Store is generally incompatible with GPL — which is why the iPhone version is a Home Screen web app.
* Nintendo, Game Boy, NES, SNES etc. are trademarks of Nintendo; this project is not affiliated with or endorsed by them.

## 📱 iPhone / iPad (runs in Safari, saved to Home Screen)

1. On your iPhone open **`https://<your-github-username>.github.io/retro-gb-nes-all-in-one/`** in **Safari** (it must be Safari — not Chrome — for *Add to Home Screen* to create a full-screen app).
2. Tap the **Share** button (square with the up-arrow at the bottom).
3. Scroll down and tap **Add to Home Screen**.
4. Tap **Add** (top-right). A *Retro Pocket* icon appears on your Home Screen.
5. Open it from the Home Screen, tap **＋ Add games**, and pick ROM files from the Files app / iCloud Drive / Downloads. Tap a game to play; tap the on-screen **Start** button once (iOS needs a tap to unlock sound).
6. Tap **‹ Library** to leave a game — it auto-saves and shows **▶ Resume** next time.

The first launch of each system downloads its core (~1–4 MB) from the EmulatorJS CDN; after that it is cached and works offline. Tip: if Safari ever clears website data for the app, the ROM library goes with it — keep your original ROM files.

## 🤖 Android

**Option A – APK:** download `RetroPocket-debug.apk` from the repo's **Releases** page (rolling `latest` release), or from the newest run in the **Actions → Build Android APK** tab (artifact `RetroPocket-debug-apk`). Open it and allow *Install unknown apps* when asked.

**Option B – PWA (no APK):** open the Pages URL above in **Chrome** → ⋮ menu → **Install app** / **Add to Home screen**.

## 🖼 Cover art

* When you add a ROM, Retro Pocket cleans the file name (`Super Mario Bros. (World) [!].nes` → *Super Mario Bros.*), looks it up in the [libretro thumbnails](https://github.com/libretro-thumbnails) listing for that system (one libretro-thumbnails repository per system, e.g. `Sony - PlayStation`, `Nintendo - Nintendo 64`, `Sega - Mega Drive - Genesis`, `FBNeo - Arcade Games`, `DOS` — see `art` in `www/js/cores.js`; every repository name was checked against GitHub), fuzzy-matches region/revision tags (e.g. *Tetris (World)* → `Tetris (World) (Rev 1).png`), tries **Named_Boxarts** then **Named_Titles**, and falls back to a generated cover (system colour + title).
* Art is downscaled and cached in IndexedDB, so it shows offline. **Refresh cover art** (per game ⋯ menu) and **🖼 Get art (n)** (library) fetch missing covers again.
* **CORS note:** `thumbnails.libretro.com` sends no `Access-Control-Allow-Origin` header, so browsers can't `fetch` it or read it into a canvas. The same files live in GitHub repos whose `raw.githubusercontent.com` / `api.github.com` endpoints are CORS-enabled, so art is fetched from there. `thumbnails.libretro.com` is only used as a display-only last resort.
* **Change cover…** (per game ⋯ menu): search prefilled with *title + system*; results from **libretro** (box art, title screens, screenshots), **Wikipedia** (page images — usually the real cover), **Wikimedia Commons**, **Internet Archive**, plus optionally **RAWG** if you paste a free API key (stored only on your device). You can also paste an image URL or upload from your camera roll / files, then pan/zoom, crop-to-cover or *Fit*, and save. If an image host blocks CORS, the picker retries through the keyless proxy `images.weserv.nl` (only for the one image you picked) and, failing that, stores a link-only cover. **Reset to automatic** goes back to the libretro match.
* SteamGridDB, IGDB and TheGamesDB require private keys and/or server-side calls, so they are not usable from a static site and are not included.

## 🎮 Nintendo DS notes

* DS emulation is **demanding**. Modern Android phones and recent iPhones can run many games but expect slowdowns; **iPhone Safari may be slow** (WebAssembly without JIT) — DeSmuME 2015 is the lighter core and the default, melonDS is more accurate but heavier (switch via the game's ⋯ menu).
* **No special headers needed for DS.** Both DS cores run in the single-threaded build; only PPSSPP and DOSBox Pure need threads (see *Threads / cross-origin isolation* below).
* Layout is top/bottom (portrait-friendly); drag/tap on the lower screen to use the stylus. DS save states are large, so auto-resume snapshots are taken only when you leave a game, not periodically.

## 🧩 Adding games for many systems

* **Detection:** unique extensions pick the system directly (`.nes`, `.gba`, `.z64`, `.md`, `.sms`, `.a26`, `.pce`, `.ws`, …). For `.bin`/`.iso`/`.cue`/`.chd`/`.zip`/`.7z`/`.img`/`.m3u`/`.pbp`/`.tap`/`.tzx`/`.exe`/`.rom`/`.ccd`, Retro Pocket first **sniffs the content** (iNES / N64 / GBA / Game Boy / Mega Drive / 32X / Master System / Game Gear / Atari 7800 / Lynx headers, `PLAYSTATION` / `SEGADISCSYSTEM` / `SEGASATURN` / PC-FX / 3DO / CD-i disc signatures, and the file names inside a `.zip`). If that is not conclusive you get a **Which system is this?** picker listing the plausible systems first (likely one highlighted) and a *Show all systems…* list. You can change a game's system later in its ⋯ menu.
* **Disc images:** select the `.cue` **together with its `.bin` file(s)** (or an `.m3u` with its discs) and they are bundled into one uncompressed ZIP in the library (which is what EmulatorJS needs; a cue whose tracks are missing is refused with a message). Single `.iso`, `.chd`, `.pbp`, `.img` and `.cso` images work as they are. Very large images (hundreds of MB) need enough free memory and storage; the app is limited to ~1.2 GB per file.
* **Arcade:** add the exact ROM-set `.zip` (FBNeo, or MAME 0.78 / 2003-Plus sets). Neo Geo sets go under **Neo Geo** and need `neogeo.zip` in Settings → BIOS files.
* **DOS:** add a game folder zipped as `.zip` (it is nested so DOSBox Pure receives the archive as-is), or a single `.exe`/`.com`/`.bat`/`.conf`. **Doom:** add your own IWAD (`.wad`).

## 🔑 BIOS files

Some consoles cannot run (or run poorly) without the original BIOS/firmware. These are copyrighted and are **never bundled or downloaded** by Retro Pocket. Open **Settings → 🔑 BIOS files…** (or ⋯ → *BIOS files…* on a game that needs one), choose the system, and upload the files from your own console (`.zip` packs of BIOS files are unpacked; names that differ only by case, like `SCPH5501.BIN`, are corrected). They are stored in IndexedDB on your device and, at launch, handed to EmulatorJS (`EJS_biosUrl`), which places them where the core looks for them. Files that must stay zipped (`neogeo.zip`, CD-i `cdimono1.zip`) are passed through untouched. Systems that *require* a BIOS show a ⚠ note in the game's menu until you add one; see the BIOS column above. BIOS delivery is covered by `tests/library.mjs` (mGBA sees `/gba_bios.bin`; `neogeo.zip` arrives byte-identical).

## ⚠ Performance warnings

Heavy systems get a **⚠ badge** on the cover, a note in the game's menu and a banner on launch: **N64, PlayStation, PSP, Saturn, 3DO, DOS, CD-i** (and DS has its own note). Expect them to need a recent desktop or high-end phone; iPhone Safari (WebAssembly without JIT) will be slow for most of them. Heavy systems do not take periodic auto-resume snapshots (their states are huge); the snapshot is taken when you leave or background the game. The N64 default is Mupen64Plus-Next (ParaLLEl N64 on iOS, as EmulatorJS itself does); a core that aborts early triggers the automatic fallback to the alternate core.

## 🧵 Threads / cross-origin isolation (PSP, DOS)

PPSSPP and DOSBox Pure need threads, i.e. `SharedArrayBuffer`, which browsers only enable on *cross-origin isolated* pages (COOP + COEP response headers). GitHub Pages cannot send custom headers, so the service worker (`www/sw.js`, same idea as `coi-serviceworker`) adds `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` to **`player.html?…&iso=1`**, and `player.js` redirects there once (after making sure the worker is active) **only when the game's core needs threads**. Everything else stays non-isolated, because COEP would block the cross-origin script tags EmulatorJS injects: on the isolated page, `cdn.emulatorjs.org` responses are re-fetched with CORS (the CDN sends `Access-Control-Allow-Origin: *`) and returned with `Cross-Origin-Resource-Policy: cross-origin`. The library page, cover-art fetches (GitHub raw/API, Wikipedia, Commons, Internet Archive, weserv) and all other cores are untouched.

Verified in headless Chrome against a plain `python -m http.server` (no isolation headers): `crossOriginIsolated === true`, `typeof SharedArrayBuffer === 'function'`, `EJS_threads === true`, frames advance for PPSSPP and DOSBox Pure, no request blocked by COEP, GB core stays non-isolated, and the library page still reaches `api.github.com`. **Not verified on devices:** iOS Safari (16.4+ supports SharedArrayBuffer under COOP/COEP and service workers; PPSSPP additionally needs WebGL2 and plenty of RAM, so expect it to be unusable on many iPhones) and the Capacitor Android WebView (Chromium; service workers work on `https://localhost`, but isolation could not be tested here). If isolation is unavailable the player shows a clear message instead of a blank screen.

## 🚫 Not supported (no core in EmulatorJS 4.2.3)

Magnavox Odyssey², Vectrex, Pokémon Mini, Mattel Intellivision, Neo Geo CD, Fairchild Channel F, Atari ST, MSX and Game & Watch have **no core in the pinned EmulatorJS release**, so they are not offered (nothing is faked). They will appear automatically only if a future pinned version ships cores for them and `www/js/cores.js` is extended. Neo Geo (AES/MVS) works through FBNeo; Sega SG-1000, Neo Geo Pocket Color, WonderSwan Color and Famicom Disk System are included.

## 🧪 Boot tests

`tests/systems.mjs` generates a tiny original stub image per system (`scripts/make-system-stubs.py`; not games), stores it in the library, launches the player with each system's default core **and every alternate core**, taps *Start*, and checks that the core downloaded, initialised and kept producing frames (and that threaded cores run isolated). That proves the core + file hand-off path for each family, **not that real games run** — stubs are not valid commercial images, so a core running garbage still counts as booted. The latest per-core results are committed in [`docs/boot-matrix.md`](docs/boot-matrix.md). Known results with stubs: every core boots except **Philips CD-i** (needs `cdimono1.zip`, reports "Required files are missing") and **Mupen64Plus-Next** aborts on the stub image ("table index is out of bounds") — in the app that is the automatic fallback case (ParaLLEl N64 boots).

## 🕹 Controllers (Bluetooth / USB gamepads)

Uses the browser **Gamepad API**, so Xbox, PlayStation (DualShock 4 / DualSense), Switch Pro, 8BitDo, MFi and generic pads work wherever the browser sees them: **iPhone/iPad Safari 13+ (Bluetooth pairing in Settings → Bluetooth)**, Android Chrome / the Android app (Chromium WebView), and desktop. Press any button after connecting — browsers only reveal a controller after its first input.

* **Auto-detect:** a toast appears on connect/disconnect (library and in game); the first pads become Player 1, 2, 3, 4 in connection order. The on-screen touch pad is **hidden while a controller is connected**, comes back when you touch the screen (and hides again on the next controller input), and returns on disconnect.
* **Settings → 🎮 Controllers…** (not an About tab): connected pads with a live input readout, per-pad **player assignment** (Auto / Player 1–4 / Off), **button layout** (*Nintendo positions*: right = A, bottom = B — or *Xbox labels*), **stick deadzone**, left-stick-as-D-pad, hide-touch-pad, hotkeys on/off, **keyboard** controls for desktop with a preset, and a **per-player remap table** (tap a control, then press the pad button / key you want; "Reset" per player). Mappings are stored in `localStorage` (`rp.pad`) and applied to EmulatorJS (`EJS_defaultControls` + re-applied after start) for **every system**, all four players. Player counts follow each system (table above, `players` in `www/js/cores.js`: e.g. 4 for N64 and arcade, 2 for NES/SNES/Genesis/PS1, 1 for handhelds); extra controllers are ignored by one-player systems.
* **Analog sticks / triggers:** a deadzone (radial) is applied to the sticks before EmulatorJS sees them. NES/GB/GBA/SNES/DS are digital, so the left stick acts as a D-pad (and "hat" D-pads that browsers expose as an axis are decoded); analog triggers act as L2/R2 buttons. On the analog systems (**N64, PlayStation, PSP**; `analog: true` in `cores.js`) both sticks are passed through unmodified apart from the deadzone: the left stick is the analog stick (N64/PSP/PS1 analog mode), the right stick is the N64 C-buttons, **L2/R2** are the PS1/PSP triggers and **Z** on N64, L3/R3 are the stick clicks. Arcade/Neo Geo: **Select = Coin**, **Start = Start** (hold Select+Start still opens the app menu). Per-system hints are shown in the pause menu.
* **In game hotkeys:** hold **Select + Start** (or press the **Guide/Home** button) for the pause menu (Resume, Save state, Load state, Restart, Exit — also reachable with the ☰ button); **Select + R1** quick-save, **Select + L1** quick-load. While Select is held, Start/L1/R1 are not sent to the game. Turn this off in the Controllers screen if a game needs those combos.
* **Library with a controller:** D-pad / left stick moves between games and menu items, **A** opens (Nintendo layout: right button; Xbox layout: bottom button), **B** goes back/closes, **Start** opens the game's options, **Select** opens Settings, **L1/R1** switch the system filter.
* **Desktop keyboard defaults (Retro Pocket preset):** arrows = D-pad, **X** = A, **Z** = B, **S** = X, **A** = Y, **Q/W** = L/R, **Enter** = Start, **Backspace** = Select, **F5/F9** quick save/load. Remappable.
* **Tested with a mocked Gamepad API** (`node tests/pads.mjs`, headless Chrome with `navigator.getGamepads` overridden): connect/disconnect, library navigation, remap capture, deadzone, trigger handling, 2-player routing, touch-pad hiding, hotkeys and the pause menu. **Not tested on real hardware:** actual Bluetooth/USB pads, iOS Safari, and the Capacitor Android WebView (it is Chromium, so the same API is available, but the app window must have focus; some pads/OS versions report a non-standard button order — remap in the Controllers screen if so).

## 🛡 Crash protection

The player pins EmulatorJS to a fixed version (`4.2.3`, see `EJS_VERSION` in `www/js/cores.js`), flushes battery saves only while a game is running in the foreground (guarded, never throws), and only loads an auto-resume snapshot taken by the **same core**. If a core aborts or freezes, the **Game crashed** screen offers *Resume from last auto-save*, *Restart*, *Try another core* and *Back to library*; a crash in the first 15 s switches cores automatically once. NES now defaults to **Nestopia**; FCEUmm is a per-game option.

## 🛠 Build locally

```bash
git clone https://github.com/<you>/retro-gb-nes-all-in-one && cd retro-gb-nes-all-in-one
npm install

# Web app (any static server works; there's no build step)
npm start                 # http://localhost:8080
npm run check             # syntax + manifest + service-worker precache + README table sync
npm test                  # headless-Chrome end-to-end test (needs Chrome + internet for the CDN cores)
node tests/crash.mjs      # crash screen / fallback / watchdog tests
node tests/cover.mjs      # box art + cover picker tests (real network)
node tests/pads.mjs       # controller tests with a mocked Gamepad API
node tests/detect.mjs     # system detection / zip / cue unit tests (no browser)
node tests/padsys.mjs     # per-system controller wiring unit tests (no browser)
node tests/library.mjs    # picker, cue/bin bundling, BIOS upload -> emulator FS (headless Chrome)
node tests/threads.mjs    # PPSSPP/DOSBox cross-origin isolation + regression checks
KEYS=psx,n64 ALT=1 node tests/systems.mjs   # boot matrix: a stub image per system / core (all systems when KEYS is unset)
node tests/soak.mjs tests/fixtures/nes-test.nes nestopia 5   # N-minute soak

# Android APK (needs JDK 21 and the Android SDK; ANDROID_HOME set)
npm run android:debug     # -> android/app/build/outputs/apk/debug/app-debug.apk
npm run android:open      # or open in Android Studio
```

After editing anything in `www/`, run `npx cap sync android` before rebuilding the APK. Icons are generated by `npm run icons` (Pillow) and `python3 scripts/make-android-assets.py`.

### Deploying
* **GitHub Pages:** repo **Settings → Pages → Source: GitHub Actions** (the `pages.yml` workflow deploys `www/` on every push to `main`).
* **APK:** `android.yml` builds a debug-signed APK on every push, uploads it as an artifact and refreshes the `latest` release; tagging `v1.0.0` creates a versioned release.

### Self-hosting EmulatorJS (optional)
By default the loader and cores come from `https://cdn.emulatorjs.org/stable/data/`. To bundle them (fully offline from first launch), download an EmulatorJS release into `www/ejs/data/` (or the cores you need) and set `window.RP_EJS_DATA = 'ejs/data/'` before `js/player.js` loads in `www/player.html`; add the files to `SHELL_FILES` in `www/sw.js` if you want them precached.

## 🗂 Project structure

```
www/                      the whole app (static; served by Pages and bundled into the APK)
  index.html, css/app.css library UI            js/app.js     library, adding ROMs, settings
  player.html, css/player.css  game screen      js/player.js  launches EmulatorJS, saves/resumes
  js/cores.js             THE systems table (cores, extensions, BIOS, art, players)   js/db.js  IndexedDB (ROMs, states, art, BIOS)
  js/detect.js            content sniffing, ZIP reader/writer, cue/m3u parsing   js/bios.js, js/biosui.js  BIOS storage + Settings → BIOS files
  js/art.js               automatic box art (libretro)        js/cover.js  “Change cover” picker
  js/pads.js  gamepad settings/shim/control maps   js/padnav.js  controller menu navigation   js/padsui.js  Settings → Controllers
  sw.js                   offline shell + CDN runtime cache   manifest.webmanifest, icons/
android/                  Capacitor Android project (generated by `cap add android`, committed)
capacitor.config.json     appId com.retropocket.app, webDir = www
scripts/                  make-icons.py, make-android-assets.py, check.mjs, make-test-rom.py, make-system-stubs.py, systems-table.mjs (README table generator)
tests/                    e2e, crash, cover, pads, ds, soak, library, threads, systems (headless Chrome) + detect, padsys (Node); tiny generated stub images
.github/workflows/        pages.yml (deploy web) · android.yml (build APK + release)
```

## Troubleshooting
* *"Could not load the emulator"* — you're offline and haven't played that system yet; connect once to cache the core.
* *No sound on iPhone* — tap the on-screen Start button / screen once; also check the ringer switch.
* *Game crashed* — use the on-screen *Resume* / *Try another core*. *A game won't start* — try the other core via the **⋯** menu → *Emulator core*. Zipped ROMs are supported by most cores; if the system isn't recognised you'll be asked to pick one.

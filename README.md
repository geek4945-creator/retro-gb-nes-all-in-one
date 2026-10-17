# Retro Pocket — Game Boy / GBC / GBA / NES / SNES / Nintendo DS in one app

An all-in-one retro emulator that runs **in the browser** (installable on iPhone from Safari as a Home Screen app) and as an **Android APK**. It does *not* need RetroArch installed: it embeds [EmulatorJS](https://github.com/EmulatorJS/EmulatorJS), which ships the RetroArch/libretro cores compiled to WebAssembly.

| System | Extensions | Core (auto-selected) |
|---|---|---|
| Game Boy / Game Boy Color | `.gb` `.gbc` | Gambatte (or mGBA in ⚙︎ Settings / per game) |
| Game Boy Advance | `.gba` | mGBA |
| NES / Famicom | `.nes` `.fds` `.unf` | FCEUmm (or Nestopia) |
| SNES (bonus) | `.sfc` `.smc` `.swc` `.fig` | Snes9x |
| Nintendo DS ("Gameboy DS") | `.nds` | DeSmuME 2015 (or melonDS) — dual-screen layout, tap the bottom screen to use the touchscreen |

Features: **Bluetooth/USB controller support**, automatic **box art** (+ a *Change cover* picker with web search, URL paste and upload), crash protection with automatic core fallback, ROM library saved on your device (IndexedDB), add many ROMs at once, search + system filters, auto-detected core per file, on-screen touch gamepad, save states, battery saves (flushed every 30 s), **auto-resume** (your session is snapshotted when you leave a game), dark mobile-first UI, offline shell via service worker.

## ⚖️ Legal

* **Bring your own ROMs.** No games or BIOS files are included or downloaded. Only use dumps of cartridges you own, or homebrew you have the right to play. The ROMs you add never leave your device (they're stored in the browser's local database).
* **Licensing:** this project is released under **GPL-3.0** (see `LICENSE`). It loads [EmulatorJS](https://github.com/EmulatorJS/EmulatorJS) (GPL-3.0) and RetroArch/libretro cores (Gambatte GPL-2.0, mGBA MPL-2.0, FCEUmm GPL-2.0, Nestopia GPL-2.0, Snes9x non-commercial licence, DeSmuME GPL-2.0, melonDS GPL-3.0) from the EmulatorJS CDN at runtime. Check each core's licence if you redistribute or want to publish in an app store (the Snes9x licence forbids commercial use; Apple's App Store is generally incompatible with GPL — which is why the iPhone version is a Home Screen web app).
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

* When you add a ROM, Retro Pocket cleans the file name (`Super Mario Bros. (World) [!].nes` → *Super Mario Bros.*), looks it up in the [libretro thumbnails](https://github.com/libretro-thumbnails) listing for that system (`Nintendo - Game Boy`, `… Game Boy Color`, `… Game Boy Advance`, `… Nintendo Entertainment System`, `… Super Nintendo Entertainment System`, `… Nintendo DS`), fuzzy-matches region/revision tags (e.g. *Tetris (World)* → `Tetris (World) (Rev 1).png`), tries **Named_Boxarts** then **Named_Titles**, and falls back to a generated cover (system colour + title).
* Art is downscaled and cached in IndexedDB, so it shows offline. **Refresh cover art** (per game ⋯ menu) and **🖼 Get art (n)** (library) fetch missing covers again.
* **CORS note:** `thumbnails.libretro.com` sends no `Access-Control-Allow-Origin` header, so browsers can't `fetch` it or read it into a canvas. The same files live in GitHub repos whose `raw.githubusercontent.com` / `api.github.com` endpoints are CORS-enabled, so art is fetched from there. `thumbnails.libretro.com` is only used as a display-only last resort.
* **Change cover…** (per game ⋯ menu): search prefilled with *title + system*; results from **libretro** (box art, title screens, screenshots), **Wikipedia** (page images — usually the real cover), **Wikimedia Commons**, **Internet Archive**, plus optionally **RAWG** if you paste a free API key (stored only on your device). You can also paste an image URL or upload from your camera roll / files, then pan/zoom, crop-to-cover or *Fit*, and save. If an image host blocks CORS, the picker retries through the keyless proxy `images.weserv.nl` (only for the one image you picked) and, failing that, stores a link-only cover. **Reset to automatic** goes back to the libretro match.
* SteamGridDB, IGDB and TheGamesDB require private keys and/or server-side calls, so they are not usable from a static site and are not included.

## 🎮 Nintendo DS notes

* DS emulation is **demanding**. Modern Android phones and recent iPhones can run many games but expect slowdowns; **iPhone Safari may be slow** (WebAssembly without JIT) — DeSmuME 2015 is the lighter core and the default, melonDS is more accurate but heavier (switch via the game's ⋯ menu).
* **No special headers needed.** EmulatorJS only requires threads (`SharedArrayBuffer`, i.e. COOP/COEP headers) for PPSSPP and DOSBox Pure; both DS cores run in the single-threaded build used here, so GitHub Pages works as-is and no `coi-serviceworker` hack is needed.
* Layout is top/bottom (portrait-friendly); drag/tap on the lower screen to use the stylus. DS save states are large, so auto-resume snapshots are taken only when you leave a game, not periodically.

## 🕹 Controllers (Bluetooth / USB gamepads)

Uses the browser **Gamepad API**, so Xbox, PlayStation (DualShock 4 / DualSense), Switch Pro, 8BitDo, MFi and generic pads work wherever the browser sees them: **iPhone/iPad Safari 13+ (Bluetooth pairing in Settings → Bluetooth)**, Android Chrome / the Android app (Chromium WebView), and desktop. Press any button after connecting — browsers only reveal a controller after its first input.

* **Auto-detect:** a toast appears on connect/disconnect (library and in game); the first pads become Player 1, 2, 3, 4 in connection order. The on-screen touch pad is **hidden while a controller is connected**, comes back when you touch the screen (and hides again on the next controller input), and returns on disconnect.
* **Settings → 🎮 Controllers…** (not an About tab): connected pads with a live input readout, per-pad **player assignment** (Auto / Player 1–4 / Off), **button layout** (*Nintendo positions*: right = A, bottom = B — or *Xbox labels*), **stick deadzone**, left-stick-as-D-pad, hide-touch-pad, hotkeys on/off, **keyboard** controls for desktop with a preset, and a **per-player remap table** (tap a control, then press the pad button / key you want; "Reset" per player). Mappings are stored in `localStorage` (`rp.pad`) and applied to EmulatorJS (`EJS_defaultControls` + re-applied after start) for **every system**, all four players. Games support 1 player (GB/GBC/GBA/DS) or 2 (NES/SNES) at the moment.
* **Analog sticks / triggers:** a deadzone (radial) is applied to the sticks before EmulatorJS sees them. NES/GB/GBA/SNES/DS are digital, so the left stick acts as a D-pad (and "hat" D-pads that browsers expose as an axis are decoded); analog triggers act as L2/R2 buttons. For analog systems (N64/PS1/PSP — not bundled yet, code path is in `js/pads.js` `ANALOG_SYSTEMS`) stick axes are passed through unmodified apart from the deadzone.
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
npm run check             # syntax + manifest + service-worker precache checks
npm test                  # headless-Chrome end-to-end test (needs Chrome + internet for the CDN cores)
node tests/crash.mjs      # crash screen / fallback / watchdog tests
node tests/cover.mjs      # box art + cover picker tests (real network)
node tests/pads.mjs       # controller tests with a mocked Gamepad API
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
  js/cores.js             extension → system → core mapping   js/db.js  IndexedDB (ROMs, resume states, art)
  js/art.js               automatic box art (libretro)        js/cover.js  “Change cover” picker
  js/pads.js  gamepad settings/shim/control maps   js/padnav.js  controller menu navigation   js/padsui.js  Settings → Controllers
  sw.js                   offline shell + CDN runtime cache   manifest.webmanifest, icons/
android/                  Capacitor Android project (generated by `cap add android`, committed)
capacitor.config.json     appId com.retropocket.app, webDir = www
scripts/                  make-icons.py, make-android-assets.py, check.mjs, make-test-rom.py
tests/                    e2e.mjs, crash.mjs, cover.mjs, pads.mjs, ds.mjs, soak.mjs (headless Chrome; tiny generated test ROMs)
.github/workflows/        pages.yml (deploy web) · android.yml (build APK + release)
```

## Troubleshooting
* *"Could not load the emulator"* — you're offline and haven't played that system yet; connect once to cache the core.
* *No sound on iPhone* — tap the on-screen Start button / screen once; also check the ringer switch.
* *Game crashed* — use the on-screen *Resume* / *Try another core*. *A game won't start* — try the other core via the **⋯** menu → *Emulator core*. Zipped ROMs are supported by most cores; if the system isn't recognised you'll be asked to pick one.

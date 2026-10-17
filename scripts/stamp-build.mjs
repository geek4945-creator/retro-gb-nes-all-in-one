// Stamps a build number into the app so every deployment/APK is recognisably newer than the one before:
//   * www/build-info.json  { build, version, sha, date }   (read by the app for "Check for updates")
//   * www/js/version.js     BUILD (the number the running code knows about itself)
//   * www/sw.js            VERSION = 'b<build>'            (a changed service worker file is how browsers notice an update)
//   * $GITHUB_ENV          RP_VERSION_CODE / RP_VERSION_NAME for Gradle (versionCode = 1000 + build, so it always increases)
// build = number of commits in the checked-out history (needs fetch-depth: 0); identical for the Pages and APK workflows of one commit.
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
const WWW = process.env.WWW_DIR || 'www';
const sh = (c) => execSync(c, { encoding: 'utf8' }).trim();
const build = Number(process.env.RP_BUILD || sh('git rev-list --count HEAD'));
const sha = (process.env.GITHUB_SHA || sh('git rev-parse HEAD')).slice(0, 7);
const date = new Date().toISOString().slice(0, 10);
if (!Number.isInteger(build) || build < 1) throw new Error('bad build number ' + build);
const info = { build, version: `1.0.${build}`, sha, date };
writeFileSync(`${WWW}/js/version.js`, `// stamped by scripts/stamp-build.mjs (CI); "dev" when run from a checkout\nexport const BUILD = ${build};\nexport const VERSION = '${info.version}';\nexport const SHA = '${sha}';\n`);
writeFileSync(`${WWW}/build-info.json`, JSON.stringify(info) + '\n');
const sw = readFileSync(`${WWW}/sw.js`, 'utf8');
if (!/const VERSION = '[^']*';/.test(sw)) throw new Error('sw.js VERSION not found');
writeFileSync(`${WWW}/sw.js`, sw.replace(/const VERSION = '[^']*';/, `const VERSION = 'b${build}';`));
if (process.env.GITHUB_ENV) appendFileSync(process.env.GITHUB_ENV, `RP_BUILD=${build}\nRP_VERSION_CODE=${1000 + build}\nRP_VERSION_NAME=1.0.${build}-${sha}\n`);
console.log('stamped', JSON.stringify(info), 'versionCode', 1000 + build);

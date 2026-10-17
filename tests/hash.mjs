// md5 implementation used to verify BIOS files == node's crypto, for every length around the block boundaries.
import { md5 } from '../www/js/hash.js';
import { createHash, randomBytes } from 'node:crypto';
let bad = 0;
for (const n of [0, 1, 3, 55, 56, 57, 63, 64, 65, 119, 120, 127, 128, 129, 1000, 4096, 100003, 1 << 20]) {
  const b = randomBytes(n), want = createHash('md5').update(b).digest('hex');
  if (md5(b) !== want || md5(b.buffer.slice(b.byteOffset, b.byteOffset + n)) !== want) { console.log('FAIL md5 length', n); bad++; }
}
if (md5(new TextEncoder().encode('abc')) !== '900150983cd24fb0d6963f7d28e17f72') { console.log('FAIL md5 abc'); bad++; }
console.log(bad ? `${bad} failure(s)` : 'hash: all md5 checks passed'); process.exit(bad ? 1 : 0);

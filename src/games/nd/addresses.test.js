import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isLinkLocal, parseIpv6 } from './ipv6.js';

const FILES = [
  ...readdirSync('src/games/nd').map((name) => `src/games/nd/${name}`),
  'src/pages/learn/nd.astro',
  'src/content/learn/nd.md',
];
const MAC = /\b(?:[0-9a-f]{2}:){5}[0-9a-f]{2}\b/gi;
// Any run of hex digits and colons containing a colon; parseIpv6 below decides whether it is an address.
const IPV6 = /(?<![\w:])[0-9a-f:]*:[0-9a-f:]*(?![\w:/])/gi; // not followed by "/": ff00::/8 is a prefix in a comment

/** @param {string} addr */
function allowed(addr) {
  const b = /** @type {Uint8Array} */ (parseIpv6(addr));
  const documentation = b[0] === 0x20 && b[1] === 0x01 && b[2] === 0x0d && b[3] === 0xb8;
  return documentation || isLinkLocal(addr) || (b[0] === 0xff && b[1] === 0x02) || b.every((x) => x === 0);
}

describe('example addresses (CLAUDE.md, spec section 3)', () => {
  for (const file of FILES) {
    it(`${file} uses only documentation and protocol addresses`, () => {
      const text = readFileSync(file, 'utf8');
      const macs = text.match(MAC) ?? [];
      for (const mac of macs)
        expect(mac.toLowerCase(), mac).toMatch(/^(00:00:5e:00:53:[0-9a-f]{2}|33:33:[0-9a-f:]{11})$/);
      const withoutMacs = text.replace(MAC, ' ');
      for (const candidate of withoutMacs.match(IPV6) ?? []) {
        // The lesson text says "::12" for H2's interface ID, and a comment mentions "::ffff:192.0.2.1":
        // short forms of a part of an address, not addresses.
        if (/^::[0-9a-f]{1,4}$/i.test(candidate) || /^::ffff:192$/i.test(candidate)) continue;
        if (!parseIpv6(candidate)) continue; // a time, a ratio, a CSS selector: not an address
        expect(allowed(candidate), candidate).toBe(true);
      }
    });
  }
});

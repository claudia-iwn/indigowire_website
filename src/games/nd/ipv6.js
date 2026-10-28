/**
 * IPv6 addresses for the Neighbor Discovery game (spec section 13, "Frames"). DOM-free.
 * Addresses travel as text in the RFC 5952 short form (2001:db8:0:1::12) everywhere
 * except on the wire, where frames.js turns them into 16 bytes.
 */

export const UNSPECIFIED = '::';
/** Every IPv6 device on the link listens to this group. */
export const ALL_NODES = 'ff02::1';
/** Routers also listen to this one. */
export const ALL_ROUTERS = 'ff02::2';

/**
 * Text to 16 bytes, from any valid form: full, with "::", any case. The dotted IPv4 tail
 * (::ffff:192.0.2.1) is not accepted; the game never needs it.
 * @param {string} text
 * @returns {Uint8Array | null}  null when the text isn't an IPv6 address.
 */
export function parseIpv6(text) {
  const s = text.trim().toLowerCase();
  if (!/^[0-9a-f:]+$/.test(s)) return null;
  const halves = s.split('::');
  if (halves.length > 2) return null;
  /** @param {string} part */
  const groups = (part) => (part === '' ? [] : part.split(':'));
  const head = groups(halves[0]);
  const tail = halves.length === 2 ? groups(halves[1]) : [];
  const missing = 8 - head.length - tail.length;
  // Without "::" there must be exactly 8 groups; "::" stands for at least one zero group.
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const all = [...head, ...Array(halves.length === 2 ? missing : 0).fill('0'), ...tail];
  if (all.some((group) => group.length === 0 || group.length > 4)) return null;
  const bytes = new Uint8Array(16);
  all.forEach((group, i) => {
    const n = parseInt(group, 16);
    bytes[2 * i] = n >> 8;
    bytes[2 * i + 1] = n & 0xff;
  });
  return bytes;
}

/**
 * 16 bytes to RFC 5952 text: lower case, no leading zeros, and the longest run of two or
 * more zero groups (the first, if two are equally long) written as "::".
 * @param {Uint8Array} bytes
 */
export function formatIpv6(bytes) {
  /** @type {number[]} */
  const groups = [];
  for (let i = 0; i < 16; i += 2) groups.push((bytes[i] << 8) | bytes[i + 1]);
  let best = { start: -1, length: 0 };
  for (let i = 0; i < 8;) {
    if (groups[i] !== 0) {
      i++;
      continue;
    }
    let j = i;
    while (j < 8 && groups[j] === 0) j++;
    if (j - i > best.length) best = { start: i, length: j - i };
    i = j;
  }
  const hex = groups.map((group) => group.toString(16));
  if (best.length < 2) return hex.join(':');
  return `${hex.slice(0, best.start).join(':')}::${hex.slice(best.start + best.length).join(':')}`;
}

/**
 * Any valid form to RFC 5952 text, or null.
 * @param {string} text
 */
export function normalize(text) {
  const bytes = parseIpv6(text);
  return bytes ? formatIpv6(bytes) : null;
}

/** @param {string} addr */
function bytesOf(addr) {
  const bytes = parseIpv6(addr);
  if (!bytes) throw new Error(`Not an IPv6 address: ${addr}`);
  return bytes;
}

/**
 * The solicited-node group: ff02::1:ff plus the address's last 24 bits (RFC 4291 §2.7.1).
 * @param {string} addr
 */
export function solicitedNode(addr) {
  const out = new Uint8Array(16);
  out[0] = 0xff;
  out[1] = 0x02;
  out[11] = 0x01;
  out[12] = 0xff;
  out.set(bytesOf(addr).slice(13), 13);
  return formatIpv6(out);
}

/**
 * The Ethernet MAC for an IPv6 multicast address: 33:33 plus its last 32 bits (RFC 2464 §7).
 * @param {string} addr
 */
export function multicastMac(addr) {
  const last = [...bytesOf(addr).slice(12)];
  return ['33', '33', ...last.map((b) => b.toString(16).padStart(2, '0'))].join(':');
}

/** @param {string} addr  True for fe80::/10. */
export function isLinkLocal(addr) {
  const b = bytesOf(addr);
  return b[0] === 0xfe && (b[1] & 0xc0) === 0x80;
}

/** @param {string} addr  True for ff00::/8. */
export const isMulticast = (addr) => bytesOf(addr)[0] === 0xff;

/**
 * True when the first 64 bits match: the same subnet, for the /64s every LAN here uses.
 * @param {string} a
 * @param {string} b
 */
export function samePrefix64(a, b) {
  const x = bytesOf(a);
  const y = bytesOf(b);
  // Like Python's x[:8] == y[:8].
  return x.slice(0, 8).every((byte, i) => byte === y[i]);
}

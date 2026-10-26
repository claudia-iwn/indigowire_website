/**
 * Frame building and byte encoding for the inspector (spec section 6). DOM-free.
 */

export const BROADCAST_MAC = 'ff:ff:ff:ff:ff:ff';
export const ZERO_MAC = '00:00:00:00:00:00';
export const ETHERTYPE_ARP = 0x0806;
export const ETHERTYPE_IPV4 = 0x0800;
export const ARP_REQUEST = 1;
export const ARP_REPLY = 2;
/** Ethernet minimum frame size without FCS: 14-byte header + 28-byte ARP + padding. */
export const MIN_FRAME_BYTES = 60;

/**
 * The ARP part of a frame (RFC 826 field names).
 * @typedef {object} ArpPayload
 * @property {1 | 2} oper  1 = request, 2 = reply.
 * @property {string} sha  Sender hardware (MAC) address.
 * @property {string} spa  Sender protocol (IP) address.
 * @property {string} tha  Target hardware address; all zeros in a request.
 * @property {string} tpa  Target protocol address.
 */

/**
 * An Ethernet frame carrying ARP.
 * @typedef {object} ArpFrame
 * @property {string} dst  Ethernet destination MAC.
 * @property {string} src  Ethernet source MAC.
 * @property {ArpPayload} arp
 */

/**
 * One field for the inspector's decode tree, with where its bytes sit in the dump.
 * @typedef {object} Field
 * @property {string} name
 * @property {string} value   Human-readable, as Wireshark would show it.
 * @property {number} offset  First byte in the encoded frame.
 * @property {number} length  Number of bytes.
 */

/** @param {string} mac Colon-separated hex. */
const macBytes = (mac) => mac.split(':').map((part) => parseInt(part, 16));
/** @param {string} ip Dotted quad. */
const ipBytes = (ip) => ip.split('.').map(Number);
/** @param {number} n Big-endian 16-bit, as on the wire. */
const u16 = (n) => [n >> 8, n & 0xff];

/**
 * The frame's fields in wire order. encodeArpFrame and arpFields both read this,
 * so the hex dump and the decode tree cannot disagree.
 * @param {ArpFrame} frame
 * @returns {{ name: string, value: string, bytes: number[] }[]}
 */
function layout(frame) {
  const { oper, sha, spa, tha, tpa } = frame.arp;
  const fields = [
    {
      name: 'Destination',
      value: frame.dst === BROADCAST_MAC ? `${frame.dst} (broadcast)` : frame.dst,
      bytes: macBytes(frame.dst),
    },
    { name: 'Source', value: frame.src, bytes: macBytes(frame.src) },
    { name: 'EtherType', value: 'ARP (0x0806)', bytes: u16(ETHERTYPE_ARP) },
    { name: 'Hardware type', value: 'Ethernet (1)', bytes: u16(1) },
    { name: 'Protocol type', value: 'IPv4 (0x0800)', bytes: u16(ETHERTYPE_IPV4) },
    { name: 'Hardware size', value: '6', bytes: [6] },
    { name: 'Protocol size', value: '4', bytes: [4] },
    { name: 'Opcode', value: oper === ARP_REQUEST ? 'request (1)' : 'reply (2)', bytes: u16(oper) },
    { name: 'Sender MAC address', value: sha, bytes: macBytes(sha) },
    { name: 'Sender IP address', value: spa, bytes: ipBytes(spa) },
    { name: 'Target MAC address', value: tha, bytes: macBytes(tha) },
    { name: 'Target IP address', value: tpa, bytes: ipBytes(tpa) },
  ];
  const used = fields.reduce((sum, field) => sum + field.bytes.length, 0); // like Python's sum()
  const pad = MIN_FRAME_BYTES - used;
  fields.push({ name: 'Padding', value: `${pad} zero bytes`, bytes: new Array(pad).fill(0) });
  return fields;
}

/**
 * Encode a frame to its 60 bytes on the wire (without the FCS).
 * @param {ArpFrame} frame
 * @returns {Uint8Array} Like Python's bytes.
 */
export function encodeArpFrame(frame) {
  return Uint8Array.from(layout(frame).flatMap((field) => field.bytes));
}

/**
 * The decode tree for the inspector: each field with its byte range.
 * @param {ArpFrame} frame
 * @returns {Field[]}
 */
export function arpFields(frame) {
  let offset = 0;
  return layout(frame).map(({ name, value, bytes }) => {
    const field = { name, value, offset, length: bytes.length };
    offset += bytes.length;
    return field;
  });
}

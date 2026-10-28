/**
 * Frame building and byte encoding for the inspector (spec section 6). DOM-free.
 */
import { BROADCAST_MAC } from '../lan/ethernet.js';

export { BROADCAST_MAC };
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

/**
 * A data frame: an IP packet from an application, labelled rather than decoded.
 * @typedef {object} DataFrame
 * @property {string} dst  Ethernet destination MAC (the next hop's).
 * @property {string} src  Ethernet source MAC.
 * @property {{ src: string, dst: string }} ip
 * @property {'ping' | 'web' | 'dns'} app
 * @property {boolean} [reply]  True for the answer coming back.
 */

/** What each application's packet is, for labels and the inspector. */
export const APP_PAYLOAD = /** @type {const} */ ({
  ping: { short: 'ping', long: 'ICMP echo request' },
  web: { short: 'web', long: 'HTTP request over TCP' },
  dns: { short: 'DNS', long: 'DNS query over UDP' },
});

/** The answer each application gets back. */
export const APP_REPLY = /** @type {const} */ ({
  ping: { short: 'echo', long: 'ICMP echo reply' },
  web: { short: 'page', long: 'HTTP response over TCP' },
  dns: { short: 'answer', long: 'DNS answer over UDP' },
});

/**
 * Short and long names for a data frame's packet: the request, or the answer to it.
 * @param {{ app?: 'ping' | 'web' | 'dns', reply?: boolean }} frame
 * @returns {{ short: string, long: string }}
 */
export function appLabel({ app = 'ping', reply = false }) {
  return (reply ? APP_REPLY : APP_PAYLOAD)[app];
}

/**
 * A frame's kind, for its colour and the hop table.
 * @param {{ arp?: ArpPayload }} frame
 * @returns {'request' | 'reply' | 'data'}
 */
export function frameKind(frame) {
  if (!frame.arp) return 'data';
  return frame.arp.oper === ARP_REQUEST ? 'request' : 'reply';
}

/**
 * The 14-byte Ethernet header of a data frame (EtherType IPv4).
 * @param {DataFrame} frame
 * @returns {Uint8Array}
 */
export function encodeEthernetHeader(frame) {
  return Uint8Array.from([...macBytes(frame.dst), ...macBytes(frame.src), ...u16(ETHERTYPE_IPV4)]);
}

/**
 * The inspector's decode tree for a data frame. The Ethernet header has byte ranges in
 * encodeEthernetHeader's output; the IP addresses and payload are listed with length 0,
 * because the game does not decode past the frame header.
 * @param {DataFrame} frame
 * @returns {Field[]}
 */
export function dataFields(frame) {
  return [
    { name: 'Destination', value: frame.dst, offset: 0, length: 6 },
    { name: 'Source', value: frame.src, offset: 6, length: 6 },
    { name: 'EtherType', value: 'IPv4 (0x0800)', offset: 12, length: 2 },
    { name: 'IP source', value: frame.ip.src, offset: 14, length: 0 },
    { name: 'IP destination', value: frame.ip.dst, offset: 14, length: 0 },
    { name: 'Payload', value: `${appLabel(frame).long} (not decoded)`, offset: 14, length: 0 },
  ];
}

/**
 * One line describing a frame, for labels, the log and the inspector heading.
 * @param {ArpFrame | DataFrame} frame
 */
export function describeFrame(frame) {
  if ('arp' in frame) {
    const { oper, sha, spa, tpa } = frame.arp;
    if (oper === ARP_REQUEST && spa === tpa) return `Gratuitous ARP: ${spa} is at ${sha}`;
    return oper === ARP_REQUEST ? `ARP request: who has ${tpa}? Tell ${spa}` : `ARP reply: ${spa} is at ${sha}`;
  }
  const { short, long } = appLabel(frame);
  return `${short} (${long}): ${frame.ip.src} → ${frame.ip.dst}`;
}

/** IP protocol number and name for each application's packet. */
const IP_PROTOCOL = /** @type {const} */ ({ ping: 'ICMP (1)', web: 'TCP (6)', dns: 'UDP (17)' });

/**
 * One block of the frame strip, sized by its bytes.
 * @typedef {{ label: string, value: string, bytes: number, layer: 'eth' | 'arp' | 'ip' | 'payload' | 'trailer', field?: number }} StripBlock
 */
/**
 * One cell of a 32-bit header row. `field` links it to arpFields/dataFields (and the hex dump);
 * `modelled: false` marks a real header field the game doesn't simulate.
 * @typedef {{ name: string, value: string, bits: number, field?: number, modelled?: boolean }} ZoomCell
 */

/**
 * The packet breakout: the whole frame as a strip of blocks, and the inner header
 * (ARP, or IPv4 for data) as 32-bit rows, the way RFCs and textbooks draw it.
 * @param {ArpFrame | (DataFrame & { ip: { ttl?: number } })} frame
 * @returns {{ strip: StripBlock[], zoom: { title: string, layer: 'arp' | 'ip', rows: ZoomCell[][] } }}
 */
export function breakdown(frame) {
  /** @type {StripBlock[]} */
  const head = [
    {
      label: 'Destination MAC',
      value: frame.dst === BROADCAST_MAC ? 'broadcast' : frame.dst,
      bytes: 6,
      layer: 'eth',
      field: 0,
    },
    { label: 'Source MAC', value: frame.src, bytes: 6, layer: 'eth', field: 1 },
    { label: 'Type', value: 'arp' in frame ? '0x0806' : '0x0800', bytes: 2, layer: 'eth', field: 2 },
  ];
  if ('arp' in frame) {
    const f = arpFields(frame);
    /** @param {number} i @param {number} bits */
    const cell = (i, bits) => ({ name: f[i].name, value: f[i].value, bits, field: i });
    return {
      strip: [
        ...head,
        { label: 'ARP', value: frame.arp.oper === ARP_REQUEST ? 'request' : 'reply', bytes: 28, layer: 'arp' },
        { label: 'Padding', value: 'zeros', bytes: 18, layer: 'trailer', field: 12 },
        { label: 'FCS', value: 'CRC-32', bytes: 4, layer: 'trailer' },
      ],
      zoom: {
        title: 'ARP header (28 bytes)',
        layer: 'arp',
        rows: [
          [cell(3, 16), cell(4, 16)],
          [cell(5, 8), cell(6, 8), cell(7, 16)],
          [cell(8, 32)],
          [cell(9, 32)],
          [cell(10, 32)],
          [cell(11, 32)],
        ],
      },
    };
  }
  const { long } = appLabel(frame);
  /** @param {string} name @param {number} bits */
  const unmodelled = (name, bits) => ({ name, value: '·', bits, modelled: false });
  return {
    strip: [
      ...head,
      { label: 'IPv4 header', value: `${frame.ip.src} → ${frame.ip.dst}`, bytes: 20, layer: 'ip' },
      { label: long, value: 'not decoded', bytes: 16, layer: 'payload' },
      { label: 'FCS', value: 'CRC-32', bytes: 4, layer: 'trailer' },
    ],
    zoom: {
      title: 'IPv4 header (20 bytes)',
      layer: 'ip',
      rows: [
        [
          { name: 'Ver.', value: '4', bits: 4 },
          { name: 'IHL', value: '5', bits: 4 },
          unmodelled('DSCP/ECN', 8),
          unmodelled('Total length', 16),
        ],
        [unmodelled('Identification', 16), unmodelled('Flags, fragment offset', 16)],
        [
          { name: 'TTL', value: String(frame.ip.ttl ?? 64), bits: 8 },
          { name: 'Protocol', value: IP_PROTOCOL[frame.app], bits: 8 },
          unmodelled('Header checksum', 16),
        ],
        [{ name: 'Source address', value: frame.ip.src, bits: 32, field: 3 }],
        [{ name: 'Destination address', value: frame.ip.dst, bits: 32, field: 4 }],
      ],
    },
  };
}

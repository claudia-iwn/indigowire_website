/**
 * Frames for the IPv6 Neighbor Discovery game (spec section 13, "Frames"): the bytes on the
 * wire with a real ICMPv6 checksum, the field tree, the packet view's layouts and the labels.
 * DOM-free. Neighbor Solicitations and Advertisements (RFC 4861 §4.3, §4.4) and pings
 * (ICMPv6 echo, RFC 4443 §4.1) are encoded whole; web and DNS frames, like the ARP game's
 * data frames, only as far as their Ethernet header.
 */
import { parseIpv6 } from './ipv6.js';

export const ETHERTYPE_IPV6 = 0x86dd;
export const NEXT_HEADER_ICMPV6 = 58;
export const ND_NS = 135;
export const ND_NA = 136;
export const ECHO_REQUEST = 128;
export const ECHO_REPLY = 129;
/** The identifier every ping uses; its sequence number is the flow. */
export const ECHO_ID = 1;
/** Option types (RFC 4861 §4.6.1). */
const OPT_SOURCE_LLA = 1;
const OPT_TARGET_LLA = 2;

/**
 * @typedef {{ type: 135 | 136, target: string, lla?: string, router?: boolean, solicited?: boolean, override?: boolean, defends?: boolean }} NdMessage
 *   `defends` is not on the wire: it marks an NA that answers a DAD NS, so the game can name it.
 *   `lla` is the link-layer address option: the sender's MAC in an NS (none in a DAD NS), the target's in an NA.
 * @typedef {object} NdFrame
 * @property {number} id
 * @property {string} dst  Ethernet destination MAC.
 * @property {string} src  Ethernet source MAC.
 * @property {number} type  EtherType 0x86dd.
 * @property {{ src: string, dst: string, ttl: number }} ip  `ttl` holds the hop limit (the shared core's name for it).
 * @property {NdMessage} [nd]
 * @property {'ping' | 'web' | 'dns'} [app]
 * @property {boolean} [reply]
 * @property {number} flow  One per send; also a ping's sequence number.
 * @property {number} [parent]
 */

/** What each application's packet is, for labels and the inspector. */
const APP_PAYLOAD = /** @type {const} */ ({
  ping: { short: 'ping', long: 'ICMPv6 echo request' },
  web: { short: 'web', long: 'HTTP request over TCP' },
  dns: { short: 'DNS', long: 'DNS query over UDP' },
});
const APP_REPLY = /** @type {const} */ ({
  ping: { short: 'echo', long: 'ICMPv6 echo reply' },
  web: { short: 'page', long: 'HTTP response over TCP' },
  dns: { short: 'answer', long: 'DNS answer over UDP' },
});

/** @param {{ app?: 'ping' | 'web' | 'dns', reply?: boolean }} frame */
export function appLabel({ app = 'ping', reply = false }) {
  return (reply ? APP_REPLY : APP_PAYLOAD)[app];
}

/** @param {string} mac */
const macBytes = (mac) => mac.split(':').map((part) => parseInt(part, 16));
/** @param {number} n */
const u16 = (n) => [n >> 8, n & 0xff];
/** @param {number} n */
const u32 = (n) => [n >>> 24, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
/** @param {string} addr */
const ip6 = (addr) => [...(parseIpv6(addr) ?? new Uint8Array(16))];

/** True when the game encodes the whole frame: Neighbor Discovery or a ping. @param {NdFrame} frame */
const isIcmp = (frame) => Boolean(frame.nd) || (frame.app ?? 'ping') === 'ping';

/**
 * The ICMPv6 checksum (RFC 4443 §2.3): the one's-complement sum of the pseudo-header
 * (source, destination, length, next header 58) and the message with its checksum zeroed.
 * @param {string} src
 * @param {string} dst
 * @param {number[]} message
 */
export function icmpv6Checksum(src, dst, message) {
  const all = [...ip6(src), ...ip6(dst), ...u32(message.length), 0, 0, 0, NEXT_HEADER_ICMPV6, ...message];
  if (all.length % 2) all.push(0);
  let sum = 0;
  for (let i = 0; i < all.length; i += 2) sum += (all[i] << 8) | all[i + 1];
  // Fold the carries back in, like Python's while sum >> 16: sum = (sum & 0xffff) + (sum >> 16).
  while (sum > 0xffff) sum = (sum & 0xffff) + (sum >>> 16);
  return ~sum & 0xffff;
}

/**
 * The ICMPv6 message's fields, checksum still zero.
 * @param {NdFrame} frame
 * @returns {{ name: string, value: string, bytes: number[] }[]}
 */
function icmpFields(frame) {
  const { nd } = frame;
  if (!nd) {
    const type = frame.reply ? ECHO_REPLY : ECHO_REQUEST;
    return [
      { name: 'ICMPv6 type', value: `${type} (${frame.reply ? 'echo reply' : 'echo request'})`, bytes: [type] },
      { name: 'Code', value: '0', bytes: [0] },
      { name: 'Checksum', value: '', bytes: [0, 0] },
      { name: 'Identifier', value: String(ECHO_ID), bytes: u16(ECHO_ID) },
      { name: 'Sequence', value: String(frame.flow), bytes: u16(frame.flow) },
    ];
  }
  const ns = nd.type === ND_NS;
  const fields = [
    {
      name: 'ICMPv6 type',
      value: `${nd.type} (${ns ? 'Neighbor Solicitation' : 'Neighbor Advertisement'})`,
      bytes: [nd.type],
    },
    { name: 'Code', value: '0', bytes: [0] },
    { name: 'Checksum', value: '', bytes: [0, 0] },
  ];
  if (ns) {
    fields.push({ name: 'Reserved', value: '0', bytes: [0, 0, 0, 0] });
  } else {
    const flags = (nd.router ? 0x80 : 0) | (nd.solicited ? 0x40 : 0) | (nd.override ? 0x20 : 0);
    fields.push(
      {
        name: 'Flags',
        value: `Router ${nd.router ? 1 : 0}, Solicited ${nd.solicited ? 1 : 0}, Override ${nd.override ? 1 : 0}`,
        bytes: [flags],
      },
      { name: 'Reserved', value: '0', bytes: [0, 0, 0] },
    );
  }
  fields.push({ name: 'Target address', value: nd.target, bytes: ip6(nd.target) });
  if (nd.lla) {
    const type = ns ? OPT_SOURCE_LLA : OPT_TARGET_LLA;
    fields.push(
      { name: 'Option type', value: `${type} (${ns ? 'source' : 'target'} link-layer address)`, bytes: [type] },
      { name: 'Option length', value: '1 (8 bytes)', bytes: [1] },
      { name: ns ? 'Source link-layer address' : 'Target link-layer address', value: nd.lla, bytes: macBytes(nd.lla) },
    );
  }
  return fields;
}

/**
 * Every field in wire order, with its bytes. encodeFrame and frameFields both read this, so
 * the hex dump and the field tree cannot disagree.
 * @param {NdFrame} frame
 */
function layout(frame) {
  const fields = [
    {
      name: 'Destination',
      value: frame.dst.startsWith('33:33') ? `${frame.dst} (IPv6 multicast)` : frame.dst,
      bytes: macBytes(frame.dst),
    },
    { name: 'Source', value: frame.src, bytes: macBytes(frame.src) },
    { name: 'EtherType', value: 'IPv6 (0x86dd)', bytes: u16(ETHERTYPE_IPV6) },
  ];
  if (!isIcmp(frame)) return fields;
  const icmp = icmpFields(frame);
  const message = icmp.flatMap((field) => field.bytes); // like Python's [b for f in icmp for b in f.bytes]
  const sum = icmpv6Checksum(frame.ip.src, frame.ip.dst, message);
  const checksum = /** @type {(typeof icmp)[number]} */ (icmp.find((field) => field.name === 'Checksum'));
  checksum.bytes = u16(sum);
  checksum.value = `0x${sum.toString(16).padStart(4, '0')}`;
  fields.push(
    { name: 'Version, traffic class, flow label', value: '6, 0, 0', bytes: u32(0x60000000) },
    { name: 'Payload length', value: `${message.length} bytes`, bytes: u16(message.length) },
    { name: 'Next header', value: 'ICMPv6 (58)', bytes: [NEXT_HEADER_ICMPV6] },
    { name: 'Hop limit', value: String(frame.ip.ttl), bytes: [frame.ip.ttl] },
    { name: 'Source address', value: frame.ip.src, bytes: ip6(frame.ip.src) },
    { name: 'Destination address', value: frame.ip.dst, bytes: ip6(frame.ip.dst) },
    ...icmp,
  );
  return fields;
}

/**
 * The frame's bytes, without the FCS.
 * @param {NdFrame} frame
 */
export function encodeFrame(frame) {
  return Uint8Array.from(layout(frame).flatMap((field) => field.bytes));
}

/**
 * The packet view's field tree, with each field's place in encodeFrame's bytes. For web and
 * DNS, the IPv6 addresses and payload are listed with length 0: they are not decoded.
 * @param {NdFrame} frame
 * @returns {{ name: string, value: string, offset: number, length: number }[]}
 */
export function frameFields(frame) {
  let offset = 0;
  const fields = layout(frame).map(({ name, value, bytes }) => {
    const field = { name, value, offset, length: bytes.length };
    offset += bytes.length;
    return field;
  });
  if (isIcmp(frame)) return fields;
  return [
    ...fields,
    { name: 'IPv6 source', value: frame.ip.src, offset: 14, length: 0 },
    { name: 'IPv6 destination', value: frame.ip.dst, offset: 14, length: 0 },
    { name: 'Payload', value: `${appLabel(frame).long} (not decoded)`, offset: 14, length: 0 },
  ];
}

/**
 * One line describing a frame, for labels, the log and the packet view's heading.
 * @param {NdFrame} frame
 */
export function describeFrame(frame) {
  const { nd, ip } = frame;
  if (nd?.type === ND_NS) {
    if (ip.src === '::') return `Duplicate Address Detection: is anyone using ${nd.target}?`;
    if (ip.dst === nd.target) return `Neighbor Solicitation (check): are you still ${nd.target}?`;
    return `Neighbor Solicitation: who has ${nd.target}?`;
  }
  if (nd?.defends) return `Neighbor Advertisement (DAD defence): ${nd.target} is already at ${nd.lla}`;
  if (nd) return `${nd.solicited ? '' : 'Unsolicited '}Neighbor Advertisement: ${nd.target} is at ${nd.lla}`;
  const { short, long } = appLabel(frame);
  return `${short} (${long}): ${ip.src} → ${ip.dst}`;
}

/** @param {NdFrame} frame @returns {'request' | 'reply' | 'data'} */
export function frameKind(frame) {
  if (!frame.nd) return 'data';
  return frame.nd.type === ND_NS ? 'request' : 'reply';
}

/** The short label drawn on a moving frame. @param {NdFrame} frame */
export function frameLabel(frame) {
  if (!frame.nd) return appLabel(frame).short;
  if (frame.nd.type === ND_NA) return 'NA';
  return frame.ip.src === '::' ? 'DAD' : 'NS';
}

/**
 * Notes for the packet view: why an ND frame's hop limit is 255, and where a multicast MAC comes from.
 * @param {NdFrame} frame
 */
export function frameNotes(frame) {
  if (!frame.nd) return [];
  const notes = [
    'Hop limit 255: a receiver drops Neighbor Discovery with any other value, so it can only come from this link.',
  ];
  if (frame.dst.startsWith('33:33')) {
    notes.push(
      `The destination MAC ${frame.dst} is made from the destination address ${frame.ip.dst}: 33:33 and its last 32 bits.`,
    );
  }
  if (frame.nd.defends) notes.push('Solicited 0: the asker uses ::, so the answer goes to all nodes.');
  return notes;
}

/**
 * One block of the frame strip, and one cell of a 32-bit header row (as in the ARP game).
 * @typedef {{ label: string, value: string, bytes: number, layer: 'eth' | 'ip' | 'icmpv6' | 'payload' | 'trailer', field?: number }} StripBlock
 * @typedef {{ name: string, value: string, bits: number, field?: number, modelled?: boolean }} ZoomCell
 */

/**
 * The packet breakout: the whole frame as a strip of blocks, and one header in 32-bit rows,
 * the way RFCs draw it: the ND message for Neighbor Discovery, the IPv6 header otherwise.
 * @param {NdFrame} frame
 * @returns {{ strip: StripBlock[], zoom: { title: string, layer: 'ip' | 'icmpv6', rows: ZoomCell[][] } }}
 */
export function breakdown(frame) {
  const f = frameFields(frame);
  /** @param {number} i @param {number} bits @param {string} [name] @param {string} [value] */
  const cell = (i, bits, name = f[i].name, value = f[i].value) => ({ name, value, bits, field: i });
  /** @type {StripBlock[]} */
  const head = [
    { label: 'Destination MAC', value: frame.dst, bytes: 6, layer: 'eth', field: 0 },
    { label: 'Source MAC', value: frame.src, bytes: 6, layer: 'eth', field: 1 },
    { label: 'Type', value: '0x86dd', bytes: 2, layer: 'eth', field: 2 },
  ];
  /** @type {StripBlock} */
  const ipBlock = { label: 'IPv6 header', value: `${frame.ip.src} → ${frame.ip.dst}`, bytes: 40, layer: 'ip' };
  /** @type {StripBlock} */
  const fcs = { label: 'FCS', value: 'CRC-32', bytes: 4, layer: 'trailer' };

  if (!isIcmp(frame)) {
    /** @param {string} name @param {number} bits */
    const unmodelled = (name, bits) => ({ name, value: '·', bits, modelled: false });
    return {
      strip: [
        ...head,
        ipBlock,
        { label: appLabel(frame).long, value: 'not decoded', bytes: 20, layer: 'payload' },
        fcs,
      ],
      zoom: {
        title: 'IPv6 header (40 bytes)',
        layer: 'ip',
        rows: [
          [
            { name: 'Ver.', value: '6', bits: 4 },
            { name: 'Traffic class', value: '0', bits: 8 },
            { name: 'Flow label', value: '0', bits: 20 },
          ],
          [
            unmodelled('Payload length', 16),
            { name: 'Next header', value: frame.app === 'web' ? 'TCP (6)' : 'UDP (17)', bits: 8 },
            { name: 'Hop limit', value: String(frame.ip.ttl), bits: 8 },
          ],
          [{ name: 'Source address', value: frame.ip.src, bits: 128, field: 3 }],
          [{ name: 'Destination address', value: frame.ip.dst, bits: 128, field: 4 }],
        ],
      },
    };
  }

  const messageBytes = f.slice(9).reduce((n, field) => n + field.length, 0);
  if (!frame.nd) {
    return {
      strip: [
        ...head,
        ipBlock,
        { label: appLabel(frame).long, value: `sequence ${frame.flow}`, bytes: messageBytes, layer: 'payload' },
        fcs,
      ],
      zoom: {
        title: 'IPv6 header (40 bytes)',
        layer: 'ip',
        rows: [
          [cell(3, 4, 'Ver.', '6'), cell(3, 8, 'Traffic class', '0'), cell(3, 20, 'Flow label', '0')],
          [cell(4, 16), cell(5, 8), cell(6, 8)],
          [cell(7, 128)],
          [cell(8, 128)],
        ],
      },
    };
  }

  const { nd } = frame;
  const ns = nd.type === ND_NS;
  /**
   * The link-layer option in two rows: 16 bits after its type and length, then the other 32.
   * @param {number} first
   */
  const option = (first) =>
    nd.lla
      ? [
          [
            cell(first, 8, 'Option type'),
            cell(first + 1, 8, 'Length'),
            cell(first + 2, 16, 'Link-layer address', nd.lla.slice(0, 5)),
          ],
          [cell(first + 2, 32, 'Link-layer address (cont.)', nd.lla.slice(6))],
        ]
      : [];
  const rows = ns
    ? [[cell(9, 8, 'Type'), cell(10, 8), cell(11, 16)], [cell(12, 32)], [cell(13, 128)], ...option(14)]
    : [
        [cell(9, 8, 'Type'), cell(10, 8), cell(11, 16)],
        [
          cell(12, 1, 'R', nd.router ? '1' : '0'),
          cell(12, 1, 'S', nd.solicited ? '1' : '0'),
          cell(12, 1, 'O', nd.override ? '1' : '0'),
          cell(13, 29, 'Reserved', '0'),
        ],
        [cell(14, 128)],
        ...option(15),
      ];
  return {
    strip: [
      ...head,
      ipBlock,
      { label: ns ? 'ICMPv6 NS' : 'ICMPv6 NA', value: nd.target, bytes: messageBytes, layer: 'icmpv6' },
      fcs,
    ],
    zoom: {
      title: `${ns ? 'Neighbor Solicitation' : 'Neighbor Advertisement'} (${messageBytes} bytes)`,
      layer: 'icmpv6',
      rows,
    },
  };
}

import { describe, expect, it } from 'vitest';
import {
  breakdown,
  describeFrame,
  encodeFrame,
  frameFields,
  frameKind,
  frameLabel,
  frameNotes,
  icmpv6Checksum,
} from './frames.js';

const H1 = '00:00:5e:00:53:11';
const H2 = '00:00:5e:00:53:12';
const H3 = '00:00:5e:00:53:13';
const G1 = '2001:db8:0:1::11';
const G2 = '2001:db8:0:1::12';
const G3 = '2001:db8:0:1::13';
const base = { id: 1, flow: 1, type: 0x86dd };

const FRAMES = {
  ns: {
    ...base,
    dst: '33:33:ff:00:00:12',
    src: H1,
    ip: { src: G1, dst: 'ff02::1:ff00:12', ttl: 255 },
    nd: { type: 135, target: G2, lla: H1 },
  },
  na: {
    ...base,
    dst: H1,
    src: H2,
    ip: { src: G2, dst: G1, ttl: 255 },
    nd: { type: 136, target: G2, lla: H2, router: false, solicited: true, override: true },
  },
  dad: {
    ...base,
    dst: '33:33:ff:00:00:13',
    src: H3,
    ip: { src: '::', dst: 'ff02::1:ff00:13', ttl: 255 },
    nd: { type: 135, target: G3 },
  },
  unsolicited: {
    ...base,
    dst: '33:33:00:00:00:01',
    src: H3,
    ip: { src: G2, dst: 'ff02::1', ttl: 255 },
    nd: { type: 136, target: G2, lla: H3, router: false, solicited: false, override: true },
  },
  echo: { ...base, dst: H2, src: H1, ip: { src: G1, dst: G2, ttl: 64 }, app: 'ping' },
  echoReply: { ...base, dst: H1, src: H2, ip: { src: G2, dst: G1, ttl: 64 }, app: 'ping', reply: true },
};

/** Scapy's bytes for the same frames (no FCS). */
const SCAPY = {
  ns: '3333ff00001200005e00531186dd6000000000203aff20010db8000000010000000000000011ff0200000000000000000001ff00001287006ce40000000020010db8000000010000000000000012010100005e005311',
  na: '00005e00531100005e00531286dd6000000000203aff20010db800000001000000000000001220010db80000000100000000000000118800db2d6000000020010db8000000010000000000000012020100005e005312',
  dad: '3333ff00001300005e00531386dd6000000000183aff00000000000000000000000000000000ff0200000000000000000001ff00001387004cc80000000020010db8000000010000000000000013',
  unsolicited:
    '33330000000100005e00531386dd6000000000203aff20010db8000000010000000000000012ff020000000000000000000000000001880049f42000000020010db8000000010000000000000012020100005e005313',
  echo: '00005e00531200005e00531186dd6000000000083a4020010db800000001000000000000001120010db80000000100000000000000128000242400010001',
  echoReply:
    '00005e00531100005e00531286dd6000000000083a4020010db800000001000000000000001220010db80000000100000000000000118100232400010001',
};

/** @param {Uint8Array} bytes */
const hex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');

describe('encodeFrame', () => {
  for (const name of /** @type {(keyof typeof FRAMES)[]} */ (Object.keys(FRAMES))) {
    it(`matches Scapy byte for byte: ${name}`, () => {
      expect(hex(encodeFrame(FRAMES[name]))).toBe(SCAPY[name]);
    });
  }

  it('sizes: 86 bytes for an NS or NA with its option, 78 for a DAD NS, 62 for a ping (no padding)', () => {
    expect(encodeFrame(FRAMES.ns)).toHaveLength(86);
    expect(encodeFrame(FRAMES.dad)).toHaveLength(78);
    expect(encodeFrame(FRAMES.echo)).toHaveLength(62);
  });

  it('carries only the Ethernet header for web and DNS, which are not decoded', () => {
    expect(encodeFrame({ ...FRAMES.echo, app: 'web' })).toHaveLength(14);
  });
});

describe('icmpv6Checksum', () => {
  it('is the one’s-complement sum over the pseudo-header and the message', () => {
    // The NS above with its checksum field zeroed: Scapy's checksum is 0x6ce4.
    const message = [
      0x87, 0, 0, 0, 0, 0, 0, 0, 0x20, 0x01, 0x0d, 0xb8, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0x12, 1, 1, 0, 0, 0x5e, 0,
      0x53, 0x11,
    ];
    expect(icmpv6Checksum(G1, 'ff02::1:ff00:12', message)).toBe(0x6ce4);
  });
});

describe('frameFields', () => {
  it('covers every byte once, in order, and names the checksum', () => {
    const fields = frameFields(FRAMES.na);
    let offset = 0;
    for (const field of fields) {
      expect(field.offset).toBe(offset);
      offset += field.length;
    }
    expect(offset).toBe(86);
    expect(fields.find((f) => f.name === 'Checksum')?.value).toBe('0xdb2d');
    expect(fields.find((f) => f.name === 'Hop limit')?.value).toBe('255');
    expect(fields.find((f) => f.name === 'Flags')?.value).toBe('Router 0, Solicited 1, Override 1');
  });

  it('lists a web frame’s addresses without bytes, as the ARP game does', () => {
    const fields = frameFields({ ...FRAMES.echo, app: 'web' });
    expect(fields.map((f) => f.name)).toEqual([
      'Destination',
      'Source',
      'EtherType',
      'IPv6 source',
      'IPv6 destination',
      'Payload',
    ]);
  });
});

describe('labels', () => {
  it('describes each kind of frame in one line', () => {
    expect(describeFrame(FRAMES.ns)).toBe('Neighbor Solicitation: who has 2001:db8:0:1::12?');
    expect(describeFrame({ ...FRAMES.ns, dst: H2, ip: { ...FRAMES.ns.ip, dst: G2 } })).toBe(
      'Neighbor Solicitation (check): are you still 2001:db8:0:1::12?',
    );
    expect(describeFrame(FRAMES.dad)).toBe('Duplicate Address Detection: is anyone using 2001:db8:0:1::13?');
    expect(describeFrame(FRAMES.na)).toBe('Neighbor Advertisement: 2001:db8:0:1::12 is at 00:00:5e:00:53:12');
    expect(describeFrame(FRAMES.unsolicited)).toBe(
      'Unsolicited Neighbor Advertisement: 2001:db8:0:1::12 is at 00:00:5e:00:53:13',
    );
    expect(describeFrame(FRAMES.echo)).toBe('ping (ICMPv6 echo request): 2001:db8:0:1::11 → 2001:db8:0:1::12');
  });

  it('kinds and short labels', () => {
    expect([FRAMES.ns, FRAMES.na, FRAMES.echo].map(frameKind)).toEqual(['request', 'reply', 'data']);
    expect([FRAMES.ns, FRAMES.dad, FRAMES.na, FRAMES.echo, FRAMES.echoReply].map(frameLabel)).toEqual([
      'NS',
      'DAD',
      'NA',
      'ping',
      'echo',
    ]);
  });
});

describe('breakdown', () => {
  it('draws an NS as Ethernet, IPv6, ICMPv6 and FCS, and zooms into the solicitation', () => {
    const { strip, zoom } = breakdown(FRAMES.ns);
    expect(strip.map((b) => [b.label, b.bytes, b.layer])).toEqual([
      ['Destination MAC', 6, 'eth'],
      ['Source MAC', 6, 'eth'],
      ['Type', 2, 'eth'],
      ['IPv6 header', 40, 'ip'],
      ['ICMPv6 NS', 32, 'icmpv6'],
      ['FCS', 4, 'trailer'],
    ]);
    expect(zoom.title).toBe('Neighbor Solicitation (32 bytes)');
    expect(zoom.rows.map((row) => row.reduce((bits, cell) => bits + Math.min(cell.bits, 32), 0))).toEqual(
      Array(zoom.rows.length).fill(32),
    );
  });

  it('shows the NA flags as three 1-bit cells', () => {
    const { zoom } = breakdown(FRAMES.na);
    expect(zoom.rows[1].map((cell) => [cell.name, cell.value, cell.bits])).toEqual([
      ['R', '0', 1],
      ['S', '1', 1],
      ['O', '1', 1],
      ['Reserved', '0', 29],
    ]);
  });

  it('zooms into the IPv6 header for a ping', () => {
    const { strip, zoom } = breakdown(FRAMES.echo);
    expect(strip.map((b) => b.layer)).toEqual(['eth', 'eth', 'eth', 'ip', 'payload', 'trailer']);
    expect(zoom.title).toBe('IPv6 header (40 bytes)');
    expect(zoom.rows[1].map((cell) => cell.name)).toEqual(['Payload length', 'Next header', 'Hop limit']);
  });
});

describe('frameNotes', () => {
  it('explains the hop limit and a multicast MAC on ND frames, and nothing on a ping', () => {
    expect(frameNotes(FRAMES.ns)).toEqual([
      'Hop limit 255: a receiver drops Neighbor Discovery with any other value, so it can only come from this link.',
      'The destination MAC 33:33:ff:00:00:12 is made from the destination address ff02::1:ff00:12: 33:33 and its last 32 bits.',
    ]);
    expect(frameNotes(FRAMES.na)).toHaveLength(1);
    expect(frameNotes(FRAMES.echo)).toEqual([]);
  });
});

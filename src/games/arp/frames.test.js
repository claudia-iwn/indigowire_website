import { describe, expect, it } from 'vitest';
import {
  arpFields,
  breakdown,
  dataFields,
  describeFrame,
  appLabel,
  encodeArpFrame,
  encodeEthernetHeader,
  BROADCAST_MAC,
  ZERO_MAC,
  MIN_FRAME_BYTES,
} from './frames.js';

/** H1 asking who has 192.0.2.12, as in the spec's first acceptance criterion. */
const REQUEST = {
  dst: BROADCAST_MAC,
  src: '00:00:5e:00:53:11',
  arp: { oper: /** @type {1} */ (1), sha: '00:00:5e:00:53:11', spa: '192.0.2.11', tha: ZERO_MAC, tpa: '192.0.2.12' },
};

/** H1's ping to 8.8.8.8, addressed to the gateway R1. */
const DATA = {
  dst: '00:00:5e:00:53:01',
  src: '00:00:5e:00:53:11',
  ip: { src: '192.0.2.11', dst: '8.8.8.8' },
  app: /** @type {'ping'} */ ('ping'),
};

/** @param {Uint8Array} bytes */
const hex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join(' ');

describe('encodeArpFrame', () => {
  it('encodes a request as exactly 60 bytes', () => {
    expect(encodeArpFrame(REQUEST)).toHaveLength(MIN_FRAME_BYTES);
  });

  it('lays out the Ethernet header, ARP payload and zero padding per RFC 826', () => {
    const bytes = encodeArpFrame(REQUEST);
    // Ethernet: dst, src, EtherType 0x0806.
    expect(hex(bytes.subarray(0, 14))).toBe('ff ff ff ff ff ff 00 00 5e 00 53 11 08 06');
    // ARP: HTYPE 1, PTYPE 0x0800, HLEN 6, PLEN 4, OPER 1.
    expect(hex(bytes.subarray(14, 22))).toBe('00 01 08 00 06 04 00 01');
    // SHA, SPA, THA, TPA.
    expect(hex(bytes.subarray(22, 32))).toBe('00 00 5e 00 53 11 c0 00 02 0b');
    expect(hex(bytes.subarray(32, 42))).toBe('00 00 00 00 00 00 c0 00 02 0c');
    // Padding to the 60-byte minimum.
    expect([...bytes.subarray(42)].every((b) => b === 0)).toBe(true);
  });

  it('encodes a reply with opcode 2', () => {
    const reply = { ...REQUEST, arp: { ...REQUEST.arp, oper: /** @type {2} */ (2) } };
    expect(hex(encodeArpFrame(reply).subarray(20, 22))).toBe('00 02');
  });
});

describe('arpFields', () => {
  it('lists every header field with offsets that match the encoded bytes', () => {
    const bytes = encodeArpFrame(REQUEST);
    const fields = arpFields(REQUEST);
    expect(fields.map((f) => f.name)).toEqual([
      'Destination',
      'Source',
      'EtherType',
      'Hardware type',
      'Protocol type',
      'Hardware size',
      'Protocol size',
      'Opcode',
      'Sender MAC address',
      'Sender IP address',
      'Target MAC address',
      'Target IP address',
      'Padding',
    ]);
    // The fields tile the frame with no gaps or overlaps.
    let offset = 0;
    for (const field of fields) {
      expect(field.offset).toBe(offset);
      offset += field.length;
    }
    expect(offset).toBe(MIN_FRAME_BYTES);
    // Each field's bytes are what the dump shows for it.
    const opcode = fields.find((f) => f.name === 'Opcode');
    expect(opcode?.value).toBe('request (1)');
    expect(hex(bytes.subarray(opcode?.offset, (opcode?.offset ?? 0) + (opcode?.length ?? 0)))).toBe('00 01');
    expect(fields.find((f) => f.name === 'Target IP address')?.value).toBe('192.0.2.12');
  });
});

describe('describeFrame', () => {
  it('summarises each kind of frame in one line', () => {
    expect(describeFrame(REQUEST)).toBe('ARP request: who has 192.0.2.12? Tell 192.0.2.11');
    const reply = {
      dst: '00:00:5e:00:53:11',
      src: '00:00:5e:00:53:12',
      arp: {
        oper: /** @type {2} */ (2),
        sha: '00:00:5e:00:53:12',
        spa: '192.0.2.12',
        tha: '00:00:5e:00:53:11',
        tpa: '192.0.2.11',
      },
    };
    expect(describeFrame(reply)).toBe('ARP reply: 192.0.2.12 is at 00:00:5e:00:53:12');
    const gratuitous = { ...REQUEST, arp: { ...REQUEST.arp, tpa: '192.0.2.11' } };
    expect(describeFrame(gratuitous)).toBe('Gratuitous ARP: 192.0.2.11 is at 00:00:5e:00:53:11');
    expect(describeFrame(DATA)).toBe('ping (ICMP echo request): 192.0.2.11 → 8.8.8.8');
  });

  it('names the answer that comes back for each application', () => {
    const reply = { ...DATA, ip: { src: '8.8.8.8', dst: '192.0.2.11' }, reply: true };
    expect(describeFrame(reply)).toBe('echo (ICMP echo reply): 8.8.8.8 → 192.0.2.11');
    expect(appLabel({ app: 'web', reply: true })).toEqual({ short: 'page', long: 'HTTP response over TCP' });
    expect(appLabel({ app: 'dns', reply: true }).long).toBe('DNS answer over UDP');
    expect(appLabel({ app: 'dns' }).long).toBe('DNS query over UDP');
  });
});

describe('dataFields', () => {
  it('decodes the Ethernet header with byte offsets and lists the IP addresses without bytes', () => {
    const fields = dataFields(DATA);
    expect(fields.slice(0, 3)).toEqual([
      { name: 'Destination', value: '00:00:5e:00:53:01', offset: 0, length: 6 },
      { name: 'Source', value: '00:00:5e:00:53:11', offset: 6, length: 6 },
      { name: 'EtherType', value: 'IPv4 (0x0800)', offset: 12, length: 2 },
    ]);
    expect(fields.slice(3).map((f) => [f.name, f.value, f.length])).toEqual([
      ['IP source', '192.0.2.11', 0],
      ['IP destination', '8.8.8.8', 0],
      ['Payload', 'ICMP echo request (not decoded)', 0],
    ]);
    expect(hex(encodeEthernetHeader(DATA))).toBe('00 00 5e 00 53 01 00 00 5e 00 53 11 08 00');
  });
});

describe('breakdown', () => {
  it('lays an ARP frame out as Ethernet, ARP, padding and FCS, with the ARP header in 32-bit rows', () => {
    const { strip, zoom } = breakdown(REQUEST);
    expect(strip.map((b) => [b.label, b.bytes, b.layer])).toEqual([
      ['Destination MAC', 6, 'eth'],
      ['Source MAC', 6, 'eth'],
      ['Type', 2, 'eth'],
      ['ARP', 28, 'arp'],
      ['Padding', 18, 'trailer'],
      ['FCS', 4, 'trailer'],
    ]);
    expect(zoom.layer).toBe('arp');
    expect(zoom.rows.map((row) => row.map((c) => c.name))).toEqual([
      ['Hardware type', 'Protocol type'],
      ['Hardware size', 'Protocol size', 'Opcode'],
      ['Sender MAC address'],
      ['Sender IP address'],
      ['Target MAC address'],
      ['Target IP address'],
    ]);
    // Cells link to arpFields by index, so hovering one highlights its bytes.
    expect(zoom.rows[1][2]).toMatchObject({ value: 'request (1)', bits: 16, field: 7 });
  });

  it('lays a data frame out as Ethernet, IPv4 header, payload and FCS, with the IPv4 header in 32-bit rows', () => {
    const frame = { ...DATA, ip: { ...DATA.ip, ttl: 63 } };
    const { strip, zoom } = breakdown(frame);
    expect(strip.map((b) => [b.label, b.layer])).toEqual([
      ['Destination MAC', 'eth'],
      ['Source MAC', 'eth'],
      ['Type', 'eth'],
      ['IPv4 header', 'ip'],
      ['ICMP echo request', 'payload'],
      ['FCS', 'trailer'],
    ]);
    expect(zoom.layer).toBe('ip');
    const cells = zoom.rows.flat();
    expect(cells.find((c) => c.name === 'TTL')).toMatchObject({ value: '63', bits: 8 });
    expect(cells.find((c) => c.name === 'Protocol')).toMatchObject({ value: 'ICMP (1)' });
    expect(cells.find((c) => c.name === 'Destination address')).toMatchObject({ value: '8.8.8.8', bits: 32 });
    expect(zoom.rows.every((row) => row.reduce((sum, c) => sum + c.bits, 0) === 32)).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import { arpFields, encodeArpFrame, BROADCAST_MAC, ZERO_MAC, MIN_FRAME_BYTES } from './frames.js';

/** H1 asking who has 10.0.0.12, as in the spec's first acceptance criterion. */
const REQUEST = {
  dst: BROADCAST_MAC,
  src: '02:00:00:00:00:11',
  arp: { oper: /** @type {1} */ (1), sha: '02:00:00:00:00:11', spa: '10.0.0.11', tha: ZERO_MAC, tpa: '10.0.0.12' },
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
    expect(hex(bytes.subarray(0, 14))).toBe('ff ff ff ff ff ff 02 00 00 00 00 11 08 06');
    // ARP: HTYPE 1, PTYPE 0x0800, HLEN 6, PLEN 4, OPER 1.
    expect(hex(bytes.subarray(14, 22))).toBe('00 01 08 00 06 04 00 01');
    // SHA, SPA, THA, TPA.
    expect(hex(bytes.subarray(22, 32))).toBe('02 00 00 00 00 11 0a 00 00 0b');
    expect(hex(bytes.subarray(32, 42))).toBe('00 00 00 00 00 00 0a 00 00 0c');
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
    expect(fields.find((f) => f.name === 'Target IP address')?.value).toBe('10.0.0.12');
  });
});

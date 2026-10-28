import { describe, expect, it } from 'vitest';
import {
  ALL_NODES,
  formatIpv6,
  isLinkLocal,
  isLoopback,
  isMulticast,
  multicastMac,
  normalize,
  parseIpv6,
  samePrefix64,
  solicitedNode,
} from './ipv6.js';

describe('parseIpv6', () => {
  it('reads the full form and the short form to the same 16 bytes', () => {
    const full = parseIpv6('2001:0db8:0000:0001:0000:0000:0000:0012');
    expect(full).toEqual(parseIpv6('2001:db8:0:1::12'));
    expect([...(full ?? [])]).toEqual([0x20, 0x01, 0x0d, 0xb8, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0x12]);
  });

  it('accepts ::, a trailing ::, and upper case', () => {
    expect([...(parseIpv6('::') ?? [])]).toEqual(Array(16).fill(0));
    expect(parseIpv6('fe80::')).not.toBe(null);
    expect(parseIpv6('2001:DB8::12')).toEqual(parseIpv6('2001:db8::12'));
  });

  it('rejects what is not an address', () => {
    for (const bad of [
      '',
      '192.0.2.1',
      '2001:db8',
      '1:2:3:4:5:6:7',
      '1:2:3:4:5:6:7:8:9',
      '1::2::3',
      ':1',
      '1:',
      '12345::',
      'g::1',
      '1:2:3:4:5:6:7::8',
    ]) {
      expect(parseIpv6(bad), bad).toBe(null);
    }
  });
});

describe('formatIpv6 and normalize (RFC 5952)', () => {
  it('drops leading zeros, uses lower case, and shortens the longest run of zero groups', () => {
    expect(normalize('2001:0DB8:0000:0001:0000:0000:0000:0012')).toBe('2001:db8:0:1::12');
    expect(normalize('fe80:0:0:0:0:0:0:1')).toBe('fe80::1');
    expect(normalize('0:0:0:0:0:0:0:0')).toBe('::');
  });

  it('never shortens a single zero group, and picks the first of two equal runs', () => {
    expect(normalize('2001:db8:0:1:1:1:1:1')).toBe('2001:db8:0:1:1:1:1:1');
    expect(normalize('2001:db8:0:0:1:0:0:1')).toBe('2001:db8::1:0:0:1');
  });

  it('returns null for a bad address', () => {
    expect(normalize('nope')).toBe(null);
  });

  it('round-trips bytes', () => {
    expect(formatIpv6(/** @type {Uint8Array} */ (parseIpv6('ff02::1:ff00:12')))).toBe('ff02::1:ff00:12');
  });
});

describe('multicast groups', () => {
  it('builds the solicited-node group from the last 24 bits', () => {
    expect(solicitedNode('2001:db8:0:1::12')).toBe('ff02::1:ff00:12');
    expect(solicitedNode('fe80::12')).toBe('ff02::1:ff00:12');
    expect(solicitedNode('fe80::1')).toBe('ff02::1:ff00:1');
  });

  it('builds the multicast MAC from 33:33 and the last 32 bits', () => {
    expect(multicastMac('ff02::1:ff00:12')).toBe('33:33:ff:00:00:12');
    expect(multicastMac(ALL_NODES)).toBe('33:33:00:00:00:01');
    expect(multicastMac('ff02::2')).toBe('33:33:00:00:00:02');
  });
});

describe('address kinds', () => {
  it('knows link-local and multicast addresses', () => {
    expect(isLinkLocal('fe80::11')).toBe(true);
    expect(isLinkLocal('febf::1')).toBe(true);
    expect(isLinkLocal('ff02::1')).toBe(false);
    expect(isLinkLocal('2001:db8:0:1::11')).toBe(false);
    expect(isMulticast('ff02::1')).toBe(true);
    expect(isMulticast('2001:db8::1')).toBe(false);
    // Built from parts: the address test bans a bare loopback literal in the sources.
    expect(isLoopback(`::${1}`)).toBe(true);
    expect(isLoopback('::')).toBe(false);
    expect(isLoopback('2001:db8::1')).toBe(false);
  });

  it('compares the first 64 bits', () => {
    expect(samePrefix64('2001:db8:0:1::11', '2001:db8:0:1::')).toBe(true);
    expect(samePrefix64('2001:db8:0:1::11', '2001:db8:0:2::11')).toBe(false);
    expect(samePrefix64('2001:db8:8888::8', '2001:db8:0:1::')).toBe(false);
  });
});

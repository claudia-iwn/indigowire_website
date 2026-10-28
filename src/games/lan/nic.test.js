import { describe, expect, it } from 'vitest';
import { BROADCAST_MAC, isGroupMac } from './ethernet.js';
import { nicDrop } from './nic.js';

const card = { mac: '00:00:5e:00:53:12', groups: new Set(['33:33:ff:00:00:12']) };

describe('isGroupMac', () => {
  it('is true when the lowest bit of the first byte is set', () => {
    expect(isGroupMac(BROADCAST_MAC)).toBe(true);
    expect(isGroupMac('33:33:ff:00:00:12')).toBe(true);
    expect(isGroupMac('01:00:5e:00:00:01')).toBe(true);
    expect(isGroupMac('00:00:5e:00:53:12')).toBe(false);
  });
});

describe('nicDrop', () => {
  it('passes up frames for its own MAC, broadcast and its groups', () => {
    expect(nicDrop(card, '00:00:5e:00:53:12')).toBe(null);
    expect(nicDrop(card, BROADCAST_MAC)).toBe(null);
    expect(nicDrop(card, '33:33:ff:00:00:12')).toBe(null);
  });

  it('drops another host’s unicast as "not for me"', () => {
    expect(nicDrop(card, '00:00:5e:00:53:13')).toBe('not for me');
  });

  it('drops a group it has not joined in hardware', () => {
    expect(nicDrop(card, '33:33:ff:00:00:13')).toBe('not my group (network card)');
  });

  it('treats a card with no groups as joined to none', () => {
    expect(nicDrop({ mac: '00:00:5e:00:53:11' }, '33:33:ff:00:00:12')).toBe('not my group (network card)');
  });
});

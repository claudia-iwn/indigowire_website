import { describe, expect, it } from 'vitest';
import { buildHopRows } from './hops.js';
import { BROADCAST_MAC } from './ethernet.js';

const names = /** @type {Record<string, string>} */ ({ a: 'H1', r: 'R1', u: 'R1 (upstream)', n: 'next hop' });
const game = {
  nameOf: (/** @type {string} */ mac) => names[mac] ?? mac,
  kindOf: (/** @type {any} */ f) => f.kind,
  origin: (/** @type {any} */ f, /** @type {string} */ from) => `${from} started ${f.kind}`,
};

describe('buildHopRows', () => {
  it('folds one flood into one row and asks the game for host notes', () => {
    const ask = { id: 1, kind: 'request', dst: BROADCAST_MAC, src: 'a' };
    const rows = buildHopRows(
      [
        { frame: ask, from: 'H1', to: 'SW1' },
        { frame: ask, from: 'SW1', to: 'H2', how: 'flood' },
        { frame: ask, from: 'SW1', to: 'H3', how: 'flood' },
      ],
      game,
    );
    expect(rows.map((r) => [r.from, r.to.join(', '), r.ethDst, r.note])).toEqual([
      ['H1', 'SW1', 'broadcast', 'H1 started request'],
      ['SW1', 'H2, H3', 'broadcast', 'SW1 floods a copy out every other port, unchanged.'],
    ]);
  });

  it('marks what a router rebuilt, naming the hop field', () => {
    const inFrame = { id: 1, kind: 'data', dst: 'r', src: 'a', ip: { src: 'x', dst: 'y', ttl: 64 } };
    const outFrame = { id: 2, kind: 'data', dst: 'n', src: 'u', ip: { src: 'x', dst: 'y', ttl: 63 }, parent: 1 };
    const rows = buildHopRows(
      [
        { frame: inFrame, from: 'H1', to: 'R1' },
        { frame: outFrame, from: 'R1', to: 'next hop' },
      ],
      { ...game, hopName: 'Hop limit' },
    );
    expect(rows[1].changed).toEqual(['ethDst', 'ethSrc', 'ttl']);
    expect(rows[1].note).toMatch(/Hop limit 64 → 63/);
  });
});

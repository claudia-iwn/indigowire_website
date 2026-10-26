import { describe, expect, it } from 'vitest';
import { createEngine, TOPOLOGY } from './engine.js';
import { hopRows } from './hops.js';

/**
 * Run one send and collect its hops, as the renderer does.
 * @param {string} dstIp
 */
function hopsFor(dstIp) {
  const engine = createEngine();
  /** @type {any[]} */
  const hops = [];
  engine.on('frame:emit', (hop) => hops.push(hop));
  engine.send('H1', dstIp);
  engine.runUntilIdle();
  return hops;
}

/** @param {string} mac */
const nameOf = (mac) =>
  TOPOLOGY.nodes.find((n) => n.mac === mac)?.name ??
  (mac === TOPOLOGY.upstream.mac ? 'R1 (upstream)' : mac === TOPOLOGY.upstream.nextHop.mac ? 'next hop' : mac);

describe('hopRows', () => {
  it('folds a flooded broadcast into one row per switch decision', () => {
    const rows = hopRows(hopsFor('192.0.2.12'), nameOf);
    expect(rows.map((r) => `${r.from} → ${r.to.join(', ')}`)).toEqual([
      'H1 → SW1',
      'SW1 → H2, H3, R1',
      'H2 → SW1',
      'SW1 → H1',
      'H1 → SW1',
      'SW1 → H2',
      'H2 → SW1',
      'SW1 → H1',
    ]);
    expect(rows[1].note).toMatch(/floods .* unchanged/);
    expect(rows[3].note).toMatch(/forwards it unchanged/);
  });

  it('names addresses and shows the IP fields only for data frames', () => {
    const rows = hopRows(hopsFor('192.0.2.12'), nameOf);
    expect(rows[0]).toMatchObject({ kind: 'request', ethDst: 'broadcast', ethSrc: 'H1', ip: null });
    expect(rows[4]).toMatchObject({
      kind: 'data',
      ethDst: 'H2',
      ethSrc: 'H1',
      ip: { src: '192.0.2.11', dst: '192.0.2.12', ttl: 64 },
    });
  });

  it('marks exactly what R1 changed when it rebuilt the frame, and nothing for the switch', () => {
    const rows = hopRows(hopsFor('8.8.8.8'), nameOf);
    const data = rows.filter((r) => r.kind === 'data' && !r.frame.reply);
    expect(data.map((r) => `${r.from} → ${r.to.join(', ')}`)).toEqual(['H1 → SW1', 'SW1 → R1', 'R1 → next hop']);
    expect(data[1].changed).toEqual([]);
    expect(data[2]).toMatchObject({ ethDst: 'next hop', ethSrc: 'R1 (upstream)', ip: { ttl: 63 } });
    expect(data[2].changed).toEqual(['ethDst', 'ethSrc', 'ttl']);
    expect(data[2].note).toMatch(/R1 .*new frame/);
  });

  it('shows the reply coming back: R1 rewrites both MACs and the TTL again on the way in', () => {
    const rows = hopRows(hopsFor('8.8.8.8'), nameOf);
    const back = rows.filter((r) => r.frame.reply);
    expect(back.map((r) => `${r.from} → ${r.to.join(', ')}`)).toEqual(['next hop → R1', 'R1 → SW1', 'SW1 → H1']);
    expect(back[0]).toMatchObject({ ethDst: 'R1 (upstream)', ethSrc: 'next hop', ip: { src: '8.8.8.8', ttl: 56 } });
    expect(back[0].note).toMatch(/echo reply/);
    expect(back[1]).toMatchObject({ ethDst: 'H1', ethSrc: 'R1', ip: { ttl: 55 } });
    expect(back[1].changed).toEqual(['ethDst', 'ethSrc', 'ttl']);
  });
});

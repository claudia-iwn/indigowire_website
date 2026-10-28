import { describe, expect, it } from 'vitest';
import { createEngine, TOPOLOGY } from './engine.js';
import { hopRows } from './hops.js';

/** @param {(engine: ReturnType<typeof createEngine>) => void} run */
function hopsOf(run) {
  const engine = createEngine();
  /** @type {any[]} */
  const hops = [];
  engine.on('frame:emit', (hop) => hops.push(hop));
  run(engine);
  engine.runUntilIdle();
  return hops;
}

/** @param {string} mac */
const nameOf = (mac) => TOPOLOGY.nodes.find((n) => n.mac === mac)?.name ?? mac;

describe('hopRows', () => {
  it('tells what each device meant: the group question, the answer, the check', () => {
    const rows = hopRows(
      hopsOf((e) => e.send('H1', '2001:db8:0:1::12')),
      nameOf,
    );
    const notes = rows.filter((r) => r.from !== 'SW1').map((r) => r.note);
    expect(notes[0]).toBe(
      'H1 asks 2001:db8:0:1::12’s solicited-node group, ff02::1:ff00:12: who has 2001:db8:0:1::12?',
    );
    expect(notes[1]).toBe('H2 answers only H1: 2001:db8:0:1::12 is at 00:00:5e:00:53:12.');
    expect(notes).toContain('H2 checks that 2001:db8:0:1::11 is still at H1.');
    expect(rows[1]).toMatchObject({ from: 'SW1', to: ['H2', 'H3', 'R1'], ethDst: '33:33:ff:00:00:12' });
  });

  it('tells DAD and an announcement apart', () => {
    const rows = hopRows(
      hopsOf((e) => {
        e.fail('H2');
        e.takeOver('H3', '2001:db8:0:1::12');
      }),
      nameOf,
    );
    const notes = rows.filter((r) => r.from === 'H3').map((r) => r.note);
    expect(notes).toEqual([
      'H3 checks that nobody else uses 2001:db8:0:1::12 (DAD), from the unspecified address ::.',
      'H3 tells all nodes: 2001:db8:0:1::12 is at 00:00:5e:00:53:13.',
    ]);
  });

  it('names a DAD defence as an answer to the asker, not an announcement', () => {
    const rows = hopRows(
      hopsOf((e) => e.claimIp('H3', '2001:db8:0:1::12')),
      nameOf,
    );
    const note = rows.find((r) => r.from === 'H2')?.note ?? '';
    expect(note).toContain('H2 defends 2001:db8:0:1::12: tells all nodes it is at 00:00:5e:00:53:12.');
  });

  it('marks what R1 rebuilt with the hop limit', () => {
    const rows = hopRows(
      hopsOf((e) => e.send('H1', '2001:db8:8888::8')),
      nameOf,
    );
    const rebuilt = rows.find((r) => r.from === 'R1' && r.changed.length);
    expect(rebuilt?.note).toMatch(/Hop limit 64 → 63/);
  });
});

import { describe, expect, it } from 'vitest';
import { createEngine } from './engine.js';
import { LESSON, playTo, watchStep } from './lesson.js';

const G1 = '2001:db8:0:1::11';
const G2 = '2001:db8:0:1::12';

/** The clock at which each step ends, playing the lesson from the start. */
function endTimes() {
  const engine = createEngine();
  const times = [];
  for (let n = 1; n < LESSON.length; n++) {
    playTo(engine, n, n - 1);
    times.push(engine.state.clock);
  }
  return times;
}

describe('the Learn lesson', () => {
  it('has an introduction and 9 steps, each with a caption and a short note', () => {
    expect(LESSON).toHaveLength(10);
    for (const step of LESSON) {
      expect(step.caption.length).toBeGreaterThan(40);
      expect(step.note.text.length).toBeLessThanOrEqual(60);
    }
  });

  it('ends every step later than the one before, so no step’s event can be missed', () => {
    const times = endTimes();
    for (let i = 1; i < times.length; i++) expect(times[i]).toBeGreaterThan(times[i - 1]);
  });

  it('leaves the state each step describes', () => {
    const engine = createEngine();
    /** @type {string[]} */
    const drops = [];
    engine.on('frame:drop', (d) => drops.push(`${d.node}: ${d.reason}`));
    playTo(engine, 3);
    expect(drops).toEqual(['H3: not my group (network card)', 'R1: not my group (network card)']);
    expect(engine.state.hosts.H2.neighbors.get(G1)?.state).toBe('STALE');
    playTo(engine, 5, 3);
    expect(engine.state.hosts.H1.neighbors.get(G2)?.state).toBe('REACHABLE');
    playTo(engine, 8, 5);
    expect(engine.state.hosts.H2.neighbors.get(G1)?.state).toBe('REACHABLE');
  });

  it('pings again in the last step with no Neighbor Discovery', () => {
    const engine = createEngine();
    playTo(engine, 8);
    /** @type {any[]} */
    const frames = [];
    engine.on('frame:emit', (hop) => frames.push(hop.frame));
    playTo(engine, 9, 8);
    expect(frames.length).toBeGreaterThan(0);
    expect(frames.filter((f) => f.nd)).toEqual([]);
  });

  it('Back rebuilds the same state', () => {
    const a = createEngine();
    const b = createEngine();
    playTo(a, 6);
    playTo(b, 5);
    playTo(b, 6, 5);
    expect(b.state.clock).toBe(a.state.clock);
    expect([...b.state.hosts.H2.neighbors]).toEqual([...a.state.hosts.H2.neighbors]);
  });

  it('lets watchStep report a step’s end during live playback', () => {
    const engine = createEngine();
    let done = false;
    watchStep(engine, LESSON[1], () => (done = true));
    LESSON[1].start?.(engine);
    expect(done).toBe(true);
  });
});

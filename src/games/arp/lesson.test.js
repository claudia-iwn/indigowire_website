import { describe, expect, it } from 'vitest';
import { createEngine, TOPOLOGY, HOP_MS } from './engine.js';
import { LESSON, playTo, tickToward, watchStep } from './lesson.js';

const MAC = Object.fromEntries(TOPOLOGY.nodes.map((n) => [n.name, n.mac])); // name -> MAC

/** Every frame:emit, so a test can look at what went out. */
/** @param {ReturnType<typeof createEngine>} engine */
function emits(engine) {
  /** @type {any[]} */
  const seen = [];
  engine.on('frame:emit', (hop) => seen.push(hop));
  return seen;
}

describe('the Learn lesson', () => {
  it('starts with an introduction that sends nothing, and gives every later step a caption and an end', () => {
    expect(LESSON[0].until).toBeUndefined();
    expect(LESSON[0].start).toBeUndefined();
    for (const step of LESSON.slice(1)) {
      expect(step.title).toBeTruthy();
      expect(step.caption.length).toBeGreaterThan(40);
      expect(step.until).toBeDefined();
    }
  });

  it('stops each step on the event its caption describes', () => {
    const engine = createEngine();
    const seen = emits(engine);
    playTo(engine, 1);
    expect(seen.at(-1)).toMatchObject({ from: 'H1', frame: { arp: { oper: 1, tpa: '192.0.2.12' } } });
    playTo(engine, 2, 1);
    expect(seen.at(-1)).toMatchObject({ from: 'SW1', how: 'flood' });
    expect(engine.state.switch.macTable.get(MAC.H1)?.port).toBe('Gi0/1');
  });

  it('reaches the state each caption claims', () => {
    /** @param {number} n */
    const at = (n) => {
      const engine = createEngine();
      const seen = emits(engine);
      playTo(engine, n);
      return { engine, seen };
    };
    expect(at(3).engine.state.hosts.H2.arpCache.get('192.0.2.11')?.mac).toBe(MAC.H1);
    expect(at(3).seen.at(-1)).toMatchObject({ from: 'H2', frame: { arp: { oper: 2 } } });
    expect(at(4).seen.at(-1)).toMatchObject({ from: 'SW1', how: 'forward', to: 'H1' });
    expect(at(5).engine.state.hosts.H1.arpCache.get('192.0.2.12')?.mac).toBe(MAC.H2);
    expect(at(5).seen.at(-1)).toMatchObject({ from: 'H1', frame: { app: 'ping' } });
    expect(at(6).seen.at(-1)).toMatchObject({ from: 'H2', frame: { reply: true } });
    const last = at(LESSON.length - 1);
    const second = last.seen.filter((hop) => hop.frame.flow === 2);
    expect(second.length).toBeGreaterThan(0);
    expect(second.some((hop) => hop.frame.arp)).toBe(false);
  });

  it('replays to the same place every time, so Back can rebuild a step exactly', () => {
    const a = createEngine();
    const b = createEngine();
    playTo(a, 5);
    playTo(b, 5);
    expect(a.state.clock).toBe(b.state.clock);
    expect(a.state.log.map((e) => e.text)).toEqual(b.state.log.map((e) => e.text));
  });

  it('ends every step at a different moment, so live playback can stop on each one', () => {
    const engine = createEngine();
    const times = [];
    for (let n = 1; n < LESSON.length; n++) {
      playTo(engine, n, n - 1);
      times.push(engine.state.clock);
    }
    expect(new Set(times).size).toBe(times.length);
  });

  it('lets watchStep report the end of a step during live playback', () => {
    const engine = createEngine();
    let done = false;
    // Watch first, then start: the request leaves H1 the moment it is sent.
    const off = watchStep(engine, LESSON[1], () => (done = true));
    LESSON[1].start?.(engine);
    expect(done).toBe(true);
    off();
    done = false;
    const offNext = watchStep(engine, LESSON[2], () => (done = true));
    while (!done) tickToward(engine, 100);
    offNext();
    expect(engine.state.clock).toBe(HOP_MS);
  });
});

describe('tickToward', () => {
  it('never runs past the next queued event', () => {
    const engine = createEngine();
    engine.send('H1', '192.0.2.12');
    tickToward(engine, 250);
    expect(engine.state.clock).toBe(250);
    tickToward(engine, 500);
    expect(engine.state.clock).toBe(HOP_MS);
  });

  it('just advances the clock when nothing is queued', () => {
    const engine = createEngine();
    tickToward(engine, 250);
    expect(engine.state.clock).toBe(250);
  });
});

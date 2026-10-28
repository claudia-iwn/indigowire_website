import { describe, expect, it } from 'vitest';
import { createSim } from './sim.js';

const fresh = () => {
  const state = { clock: 0, log: /** @type {{ at: number, text: string }[]} */ ([]) };
  return { state, sim: createSim(state) };
};

describe('createSim', () => {
  it('runs due actions in time order, ties in the order they were scheduled', () => {
    const { state, sim } = fresh();
    /** @type {string[]} */
    const ran = [];
    sim.schedule(200, () => ran.push(`b@${state.clock}`));
    sim.schedule(100, () => ran.push(`a@${state.clock}`));
    sim.schedule(200, () => ran.push(`c@${state.clock}`));
    sim.tick(150);
    expect(ran).toEqual(['a@100']);
    expect(state.clock).toBe(150);
    sim.tick(100);
    expect(ran).toEqual(['a@100', 'b@200', 'c@200']);
    expect(state.clock).toBe(250);
  });

  it('runs actions that due actions schedule within the same tick', () => {
    const { sim } = fresh();
    /** @type {number[]} */
    const ran = [];
    sim.schedule(10, () => sim.schedule(10, () => ran.push(sim.now())));
    sim.tick(100);
    expect(ran).toEqual([20]);
  });

  it('calls onAdvance before every due action and at the end of the tick', () => {
    const state = { clock: 0, log: [] };
    /** @type {string[]} */
    const seen = [];
    const sim = createSim(state, { onAdvance: () => seen.push(`advance@${state.clock}`) });
    sim.schedule(50, () => seen.push(`run@${state.clock}`));
    sim.tick(80);
    expect(seen).toEqual(['advance@50', 'run@50', 'advance@80']);
  });

  it('emits to subscribers until they unsubscribe', () => {
    const { sim } = fresh();
    /** @type {unknown[]} */
    const got = [];
    const off = sim.on('frame:emit', (p) => got.push(p));
    sim.emit('frame:emit', 1);
    off();
    sim.emit('frame:emit', 2);
    expect(got).toEqual([1]);
  });

  it('logs with the current time and emits a log event', () => {
    const { state, sim } = fresh();
    /** @type {unknown[]} */
    const got = [];
    sim.on('log', (entry) => got.push(entry));
    sim.tick(30);
    sim.log('hello');
    expect(state.log).toEqual([{ at: 30, text: 'hello' }]);
    expect(got).toEqual([{ at: 30, text: 'hello' }]);
  });

  it('reports the next event, idleness, and runs until idle', () => {
    const { sim } = fresh();
    expect(sim.isIdle()).toBe(true);
    expect(sim.nextEventAt()).toBe(null);
    sim.schedule(40, () => sim.schedule(60, () => {}));
    expect(sim.nextEventAt()).toBe(40);
    sim.runUntilIdle();
    expect(sim.isIdle()).toBe(true);
    expect(sim.now()).toBe(100);
  });

  it('numbers frames and flows from 1', () => {
    const { sim } = fresh();
    expect([sim.frameId(), sim.frameId(), sim.flowId(), sim.frameId(), sim.flowId()]).toEqual([1, 2, 1, 3, 2]);
  });
});

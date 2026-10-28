import { describe, expect, it } from 'vitest';
import { createSim } from './sim.js';
import { playLesson, tickToward, watchStep } from './lesson.js';

/** A tiny engine: each send emits 'frame:emit' with its label after 100 ms. */
function tinyEngine() {
  const state = { clock: 0, log: [] };
  const sim = createSim(state);
  return {
    ...sim,
    state,
    /** @param {string} label */
    send: (label) => sim.schedule(100, () => sim.emit('frame:emit', { label })),
  };
}

const LESSON = [
  { title: 'intro', caption: '', note: { node: 'H1', text: '' } },
  {
    title: 'one',
    caption: '',
    note: { node: 'H1', text: '' },
    start: (/** @type {any} */ e) => e.send('a'),
    until: { event: 'frame:emit', match: (/** @type {any} */ p) => p.label === 'a' },
  },
  {
    title: 'two',
    caption: '',
    note: { node: 'H1', text: '' },
    start: (/** @type {any} */ e) => e.send('b'),
    until: { event: 'frame:emit', match: (/** @type {any} */ p) => p.label === 'b' },
  },
];

describe('lesson playback', () => {
  it('tickToward stops exactly on the next event', () => {
    const engine = tinyEngine();
    engine.send('a');
    tickToward(engine, 1000);
    expect(engine.state.clock).toBe(100);
  });

  it('watchStep fires once, on the matching event only', () => {
    const engine = tinyEngine();
    let fired = 0;
    watchStep(engine, LESSON[2], () => fired++);
    engine.send('a');
    engine.send('b');
    engine.send('b');
    engine.runUntilIdle();
    expect(fired).toBe(1);
  });

  it('playLesson runs from one step to another', () => {
    const engine = tinyEngine();
    playLesson(engine, LESSON, 1);
    expect(engine.state.clock).toBe(100);
    playLesson(engine, LESSON, 2, 1);
    expect(engine.state.clock).toBe(200);
  });

  it('a step without `until` never ends by itself, and playLesson stops when the engine runs dry', () => {
    const engine = tinyEngine();
    let fired = 0;
    const off = watchStep(engine, LESSON[0], () => fired++);
    engine.send('a');
    engine.runUntilIdle();
    off();
    expect(fired).toBe(0);
    // A step with no start and no `until`: nothing is queued, so playback returns at once.
    playLesson(engine, [LESSON[0], { title: 'x', caption: '', note: { node: 'H1', text: '' } }], 1);
    expect(engine.isIdle()).toBe(true);
  });
});

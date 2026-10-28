/**
 * Learn-mode playback shared by the LAN games (spec sections 6 and 13). DOM-free.
 *
 * Each step has a caption and the engine event it ends on. Live, the controller plays the
 * clock until that event fires (watchStep) and pauses. Back rebuilds the lesson in a fresh
 * engine and jumps straight to the step before (playLesson). The engines always do the
 * same thing for the same input, so the rebuilt state is exact.
 */

/**
 * The part of an engine the lesson needs.
 * @typedef {{ on: (event: string, handler: (payload: any) => void) => () => void, tick: (ms: number) => void,
 *   nextEventAt: () => number | null, isIdle: () => boolean, state: { clock: number } }} Engine
 */

/**
 * @typedef {object} LessonStep
 * @property {string} title
 * @property {string} caption
 * @property {{ node: string, text: string }} note  Drawn beside `node` on the diagram when the step ends.
 * @property {(engine: any) => void} [start]  Run when the step begins, e.g. a send.
 * @property {{ event: string, match: (payload: any) => boolean }} [until]
 */

/**
 * Call `onDone` once when `step`'s ending event fires.
 * @param {Engine} engine
 * @param {LessonStep} step
 * @param {() => void} onDone
 * @returns {() => void} Unsubscribe.
 */
export function watchStep(engine, step, onDone) {
  if (!step.until) return () => {};
  const { event, match } = step.until;
  let fired = false;
  return engine.on(event, (payload) => {
    if (!fired && match(payload)) {
      fired = true;
      onDone();
    }
  });
}

/**
 * Advance the clock by up to `ms`, but stop exactly on the next queued event, so a step
 * can end on the moment its event happens.
 * @param {Engine} engine
 * @param {number} ms
 */
export function tickToward(engine, ms) {
  const next = engine.nextEventAt();
  const now = engine.state.clock;
  engine.tick(next !== null && next <= now + ms ? next - now : ms);
}

/**
 * Run `lesson` instantly from the end of step `from` to the end of step `to`.
 * @param {Engine} engine
 * @param {LessonStep[]} lesson
 * @param {number} to
 * @param {number} [from]  The step the engine is already at (0 for a fresh engine).
 */
export function playLesson(engine, lesson, to, from = 0) {
  for (let n = from + 1; n <= to; n++) {
    const step = lesson[n];
    let done = false;
    const off = watchStep(engine, step, () => (done = true));
    step.start?.(engine);
    // Jump from event to event; stop if the engine runs dry (it shouldn't).
    while (!done && !engine.isIdle()) tickToward(engine, Infinity);
    off();
  }
}

/**
 * The simulation core shared by the LAN games (spec section 13, "Stage 1"): the clock,
 * the queue of timed actions, events and the log. DOM-free: no window, no document.
 *
 * Time is simulated. Work is kept in a queue of timed actions, and tick(ms) advances the
 * clock and runs whatever falls due, in order, so tests can run a whole exchange instantly.
 */

/**
 * @param {{ clock: number, log: { at: number, text: string }[] }} state  The game's state:
 *   the sim moves its clock and appends to its log.
 * @param {{ onAdvance?: () => void }} [options]  Called each time the clock moves, before any
 *   due action, and at the end of each tick (the games expire entries here).
 */
export function createSim(state, { onAdvance = () => {} } = {}) {
  /** @type {Map<string, Set<(payload: any) => void>>} */
  const listeners = new Map(); // like a Python defaultdict(set)
  /** Timed actions, run in time order (then in the order they were added). */
  /** @type {{ at: number, seq: number, run: () => void }[]} */
  let queue = [];
  let seq = 0;
  let nextFrameId = 1;
  let nextFlowId = 1;

  /**
   * @param {string} event
   * @param {(payload: any) => void} handler
   * @returns {() => void} Call to unsubscribe.
   */
  function on(event, handler) {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event)?.add(handler);
    return () => listeners.get(event)?.delete(handler);
  }

  /**
   * @param {string} event
   * @param {unknown} payload
   */
  function emit(event, payload) {
    for (const handler of listeners.get(event) ?? []) handler(payload);
  }

  /** @param {string} text One plain-English line for the event log. */
  function log(text) {
    const entry = { at: state.clock, text };
    state.log.push(entry);
    emit('log', entry);
  }

  /**
   * @param {number} delay
   * @param {() => void} run
   */
  function schedule(delay, run) {
    queue.push({ at: state.clock + delay, seq: seq++, run });
  }

  /**
   * Advance the simulated clock by `ms`, running everything that falls due on the way.
   * @param {number} ms
   */
  function tick(ms) {
    const until = state.clock + ms;
    for (;;) {
      const due = queue.filter((item) => item.at <= until);
      if (due.length === 0) break;
      // The earliest action, ties broken by the order they were scheduled.
      const next = due.reduce((a, b) => (b.at < a.at || (b.at === a.at && b.seq < a.seq) ? b : a));
      queue = queue.filter((item) => item !== next);
      state.clock = next.at;
      onAdvance();
      next.run();
    }
    state.clock = until;
    onAdvance();
  }

  /** Run until nothing is left in flight. For tests and the Step control. */
  function runUntilIdle() {
    while (queue.length > 0) tick(Math.min(...queue.map((item) => item.at)) - state.clock);
  }

  /** Simulated time of the next queued action, or null when idle. The Step control ticks to it. */
  const nextEventAt = () => (queue.length ? Math.min(...queue.map((item) => item.at)) : null);

  /** True when no frame or timer is pending. */
  const isIdle = () => queue.length === 0;

  return {
    on,
    emit,
    log,
    schedule,
    tick,
    runUntilIdle,
    nextEventAt,
    isIdle,
    /** The simulated time now, in ms. */
    now: () => state.clock,
    /** A new frame id. Like a Python itertools.count(1). */
    frameId: () => nextFrameId++,
    /** A new flow id: one per send, shared by every frame it causes. */
    flowId: () => nextFlowId++,
  };
}

/** The simulation core's type, for the modules built on it. */
/** @typedef {ReturnType<typeof createSim>} Sim */

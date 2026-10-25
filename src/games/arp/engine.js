/**
 * ARP simulation engine (spec section 6). DOM-free: no window, no document.
 * The renderer subscribes to events; it never reaches into engine state directly.
 *
 * STUB (M4): topology, state shape and the event emitter are real;
 * send(), switching, caching and aging are not implemented yet.
 */

/**
 * @typedef {object} Node
 * @property {string} name
 * @property {'host' | 'gateway' | 'attacker'} role
 * @property {string} ip      Dotted quad, no prefix.
 * @property {number} prefix  Prefix length, e.g. 24.
 * @property {string} mac     Lowercase, colon-separated.
 * @property {string} port    Switch port on SW1.
 */

/** @typedef {'frame:emit' | 'frame:arrive' | 'frame:drop' | 'cache:update' | 'cache:expire' | 'mactable:update'} EngineEvent */

/** One switch, four ports in use, attacker only in Break-it mode. Locally administered MACs. */
export const TOPOLOGY = /** @type {const} */ ({
  switch: { name: 'SW1' },
  /** @type {Node[]} */
  nodes: [
    { name: 'H1', role: 'host', ip: '10.0.0.11', prefix: 24, mac: '02:00:00:00:00:11', port: 'Gi0/1' },
    { name: 'H2', role: 'host', ip: '10.0.0.12', prefix: 24, mac: '02:00:00:00:00:12', port: 'Gi0/2' },
    { name: 'H3', role: 'host', ip: '10.0.0.13', prefix: 24, mac: '02:00:00:00:00:13', port: 'Gi0/3' },
    { name: 'R1', role: 'gateway', ip: '10.0.0.1', prefix: 24, mac: '02:00:00:00:00:01', port: 'Gi0/4' },
    { name: 'M', role: 'attacker', ip: '10.0.0.66', prefix: 24, mac: '02:00:00:00:00:66', port: 'Gi0/5' },
  ],
});

export const DEFAULT_TTL_MS = 60_000;

/**
 * Create a fresh simulation.
 * @param {{ ttlMs?: number, attacker?: boolean }} [options]
 */
export function createEngine({ ttlMs = DEFAULT_TTL_MS, attacker = false } = {}) {
  const nodes = TOPOLOGY.nodes.filter((node) => attacker || node.role !== 'attacker');

  /** @type {Map<EngineEvent, Set<(payload: unknown) => void>>} */
  const listeners = new Map(); // like a Python defaultdict(set)

  const state = {
    clock: 0,
    ttlMs,
    // hosts[name].arpCache: Map of IP -> { mac, expiresAt } (a dict of dicts in Python)
    hosts: Object.fromEntries(nodes.map((node) => [node.name, { ...node, arpCache: new Map() }])),
    switch: { name: TOPOLOGY.switch.name, macTable: new Map() },
    /** @type {{ at: number, text: string }[]} */
    log: [],
  };

  /**
   * @param {EngineEvent} event
   * @param {(payload: unknown) => void} handler
   * @returns {() => void} Call to unsubscribe.
   */
  function on(event, handler) {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event)?.add(handler);
    return () => listeners.get(event)?.delete(handler);
  }

  /**
   * @param {EngineEvent} event
   * @param {unknown} payload
   */
  function emit(event, payload) {
    for (const handler of listeners.get(event) ?? []) handler(payload);
  }

  /**
   * Send traffic from a host to an IP. TODO(M4): RFC 826 behavior from spec section 6.
   * @param {string} src
   * @param {string} dstIp
   */
  function send(src, dstIp) {
    throw new Error(`send(${src}, ${dstIp}) is not implemented yet (M4)`);
  }

  /**
   * Advance the simulated clock. TODO(M4): expire cache and MAC-table entries.
   * @param {number} ms
   */
  function tick(ms) {
    state.clock += ms;
  }

  return { state, on, emit, send, tick };
}

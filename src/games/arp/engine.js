/**
 * ARP simulation engine (spec section 6). DOM-free: no window, no document.
 * The renderer subscribes to events; it never reaches into engine state directly.
 *
 * Time is simulated. Every hop (host to switch, or switch to host) takes HOP_MS.
 * Work is kept in a queue of timed actions, and tick(ms) advances the clock and runs
 * whatever falls due, in order, so tests can run a whole exchange instantly.
 */
import { BROADCAST_MAC, ZERO_MAC, ETHERTYPE_ARP, ETHERTYPE_IPV4, ARP_REQUEST, ARP_REPLY } from './frames.js';

/**
 * @typedef {object} Node
 * @property {string} name
 * @property {'host' | 'gateway' | 'attacker'} role
 * @property {string} ip      Dotted quad, no prefix.
 * @property {number} prefix  Prefix length, e.g. 24.
 * @property {string} mac     Lowercase, colon-separated.
 * @property {string} port    Switch port on SW1.
 */

/** @typedef {'ping' | 'web' | 'dns'} App */

/**
 * A frame on the wire. ARP frames carry `arp`; data frames carry `ip` and `app`.
 * @typedef {object} Frame
 * @property {number} id
 * @property {string} dst   Ethernet destination MAC.
 * @property {string} src   Ethernet source MAC.
 * @property {number} type  EtherType: 0x0806 ARP or 0x0800 IPv4.
 * @property {import('./frames.js').ArpPayload} [arp]
 * @property {{ src: string, dst: string }} [ip]
 * @property {App} [app]
 */

/**
 * @typedef {'frame:emit' | 'frame:arrive' | 'frame:drop' | 'frame:forward' | 'cache:update' | 'cache:expire'
 *   | 'mactable:update' | 'mactable:expire' | 'arp:timeout' | 'ip:conflict' | 'log'} EngineEvent
 */

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
export const MIN_TTL_MS = 10_000;
export const MAX_TTL_MS = 300_000;
/** Simulated time for a frame to cross one link. */
export const HOP_MS = 600;
/** How long a host waits for a reply once its request has reached every host. */
export const ARP_TIMEOUT_MS = 1_000;

const SWITCH = TOPOLOGY.switch.name;
const GATEWAY = TOPOLOGY.nodes.find((node) => node.role === 'gateway');

/** @type {Record<App, string>} */
const APP_LABEL = {
  ping: 'a ping (ICMP echo request)',
  web: 'a web request (HTTP over TCP)',
  dns: 'a DNS query (UDP)',
};

/** @param {string} ip Dotted quad to a 32-bit number. `>>> 0` keeps it unsigned. */
const ipToInt = (ip) => ip.split('.').reduce((n, part) => ((n << 8) | Number(part)) >>> 0, 0);

/**
 * @param {string} a
 * @param {string} b
 * @param {number} prefix
 */
function sameSubnet(a, b, prefix) {
  const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
  return (ipToInt(a) & mask) === (ipToInt(b) & mask);
}

/**
 * Create a fresh simulation. To reset, create a new one.
 * @param {{ ttlMs?: number, attacker?: boolean }} [options]
 */
export function createEngine({ ttlMs = DEFAULT_TTL_MS, attacker = false } = {}) {
  const nodes = TOPOLOGY.nodes.filter((node) => attacker || node.role !== 'attacker');

  /** @type {Map<EngineEvent, Set<(payload: any) => void>>} */
  const listeners = new Map(); // like a Python defaultdict(set)

  const state = {
    clock: 0,
    ttlMs,
    // hosts[name].arpCache: Map of IP -> { mac, expiresAt } (a dict of dicts in Python).
    // pending: IP being resolved -> data waiting to be sent once it is.
    hosts: Object.fromEntries(
      nodes.map((node) => [
        node.name,
        {
          ...node,
          /** @type {Map<string, { mac: string, expiresAt: number }>} */
          arpCache: new Map(),
          /** @type {Map<string, { dstIp: string, app: App }[]>} */
          pending: new Map(),
        },
      ]),
    ),
    switch: {
      name: SWITCH,
      /** @type {Map<string, { port: string, expiresAt: number }>} */
      macTable: new Map(),
    },
    /** @type {{ at: number, text: string }[]} */
    log: [],
  };
  /** @typedef {(typeof state.hosts)[string]} Host */

  /** Timed actions, run in time order (then in the order they were added). */
  /** @type {{ at: number, seq: number, run: () => void }[]} */
  let queue = [];
  let seq = 0;
  let nextFrameId = 1;
  /** ARP requests being flooded, by frame id: who asked, and how many copies are still on the wire. */
  /** @type {Map<number, { host: string, ip: string, remaining: number, answered: boolean }>} */
  const floods = new Map();

  /**
   * @param {EngineEvent} event
   * @param {(payload: any) => void} handler
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

  /** @param {string} port */
  const nodeByPort = (port) => Object.values(state.hosts).find((host) => host.port === port);

  /**
   * Put a frame on a host's link toward the switch.
   * @param {Host} host
   * @param {Omit<Frame, 'id'>} fields
   */
  function transmit(host, fields) {
    const frame = /** @type {Frame} */ ({ id: nextFrameId++, ...fields });
    emit('frame:emit', { frame, from: host.name, to: SWITCH, at: state.clock, arrivesAt: state.clock + HOP_MS });
    schedule(HOP_MS, () => switchReceive(frame, host.port));
    return frame;
  }

  /**
   * SW1: learn the source MAC on the ingress port, then flood or forward.
   * @param {Frame} frame
   * @param {string} ingress
   */
  function switchReceive(frame, ingress) {
    emit('frame:arrive', { frame, node: SWITCH, time: state.clock });
    const expiresAt = state.clock + state.ttlMs;
    const known = state.switch.macTable.get(frame.src);
    state.switch.macTable.set(frame.src, { port: ingress, expiresAt });
    emit('mactable:update', { mac: frame.src, port: ingress, expiresAt });
    if (!known) log(`${SWITCH} learns that ${frame.src} is on ${ingress}.`);

    const entry = state.switch.macTable.get(frame.dst);
    /** @type {Host[]} */
    let outs;
    if (frame.dst === BROADCAST_MAC) {
      outs = Object.values(state.hosts).filter((host) => host.port !== ingress);
      log(`${SWITCH} floods the broadcast out every other port.`);
    } else if (!entry) {
      outs = Object.values(state.hosts).filter((host) => host.port !== ingress);
      log(`${SWITCH} has no entry for ${frame.dst}, so it floods the frame out every other port.`);
    } else {
      const out = nodeByPort(entry.port);
      outs = out && entry.port !== ingress ? [out] : [];
      if (out) log(`${SWITCH} knows ${frame.dst} is on ${entry.port} and forwards the frame only there.`);
    }

    const flood = floods.get(frame.id);
    if (flood) flood.remaining = outs.length;
    for (const host of outs) {
      emit('frame:emit', { frame, from: SWITCH, to: host.name, at: state.clock, arrivesAt: state.clock + HOP_MS });
      schedule(HOP_MS, () => hostReceive(host, frame));
    }
  }

  /**
   * @param {Host} host
   * @param {Frame} frame
   */
  function hostReceive(host, frame) {
    emit('frame:arrive', { frame, node: host.name, time: state.clock });
    if (frame.dst !== host.mac && frame.dst !== BROADCAST_MAC) {
      drop(host, frame, 'not for me');
    } else if (frame.arp) {
      receiveArp(host, frame, frame.arp);
    } else {
      receiveData(host, frame);
    }

    const flood = floods.get(frame.id);
    if (flood && --flood.remaining === 0) {
      floods.delete(frame.id);
      if (!flood.answered) schedule(ARP_TIMEOUT_MS, () => timeout(flood.host, flood.ip));
    }
  }

  /**
   * @param {Host} host
   * @param {Frame} frame
   * @param {string} reason
   */
  function drop(host, frame, reason) {
    emit('frame:drop', { frame, node: host.name, reason, time: state.clock });
  }

  /**
   * Add or refresh a cache entry.
   * @param {Host} host
   * @param {string} ip
   * @param {string} mac
   */
  function cache(host, ip, mac) {
    const expiresAt = state.clock + state.ttlMs;
    host.arpCache.set(ip, { mac, expiresAt });
    emit('cache:update', { host: host.name, ip, mac, expiresAt });
  }

  /**
   * RFC 826 receive rules: refresh an entry the host already has for the sender; add one
   * only when the host is the target. A request for the host's own IP gets a reply.
   * @param {Host} host
   * @param {Frame} frame
   * @param {import('./frames.js').ArpPayload} arp
   */
  function receiveArp(host, frame, arp) {
    const { oper, sha, spa, tpa } = arp;
    if (spa === host.ip && sha !== host.mac) {
      emit('ip:conflict', { host: host.name, ip: spa, mac: sha, time: state.clock });
      log(`${host.name} sees ${sha} claiming its own address ${spa}: duplicate IP address detected.`);
      return;
    }

    const had = host.arpCache.get(spa);
    if (had) {
      cache(host, spa, sha);
      if (had.mac !== sha) log(`${host.name} updates ${spa}: it was ${had.mac}, now ${sha}.`);
    }

    if (oper === ARP_REQUEST && tpa === host.ip && spa !== tpa) {
      const flood = floods.get(frame.id);
      if (flood) flood.answered = true;
      if (!had) cache(host, spa, sha);
      log(`${host.name} has ${tpa}. It caches ${spa} at ${sha} and replies directly to ${spa}.`);
      transmit(host, {
        dst: sha,
        src: host.mac,
        type: ETHERTYPE_ARP,
        arp: { oper: ARP_REPLY, sha: host.mac, spa: host.ip, tha: sha, tpa: spa },
      });
    } else if (oper === ARP_REPLY && tpa === host.ip) {
      if (!had) cache(host, spa, sha);
      log(`${host.name} learns that ${spa} is at ${sha}.`);
      const waiting = host.pending.get(spa) ?? [];
      host.pending.delete(spa);
      for (const { dstIp, app } of waiting) sendData(host, sha, dstIp, app);
    } else if (!had) {
      drop(host, frame, 'not for me');
    }
  }

  /**
   * @param {Host} host
   * @param {Frame} frame
   */
  function receiveData(host, frame) {
    const { ip, app = 'ping' } = frame;
    if (!ip) return;
    if (ip.dst === host.ip) {
      log(`${host.name} receives ${APP_LABEL[app]} from ${ip.src}.`);
    } else if (host.role === 'gateway') {
      emit('frame:forward', { frame, node: host.name, to: 'next hop', time: state.clock });
      log(
        `${host.name} removes the Ethernet header, looks up a route to ${ip.dst} and forwards the packet out its ` +
          `upstream link to the next hop. The MAC addresses change at every hop; the IP addresses stay ${ip.src} → ${ip.dst}.`,
      );
    } else {
      drop(host, frame, 'not for me');
    }
  }

  /**
   * @param {Host} host
   * @param {string} mac   Next hop's MAC.
   * @param {string} dstIp Final IP destination.
   * @param {App} app
   */
  function sendData(host, mac, dstIp, app) {
    log(`${host.name} sends ${APP_LABEL[app]} to ${dstIp} in a frame addressed to ${mac}.`);
    transmit(host, { dst: mac, src: host.mac, type: ETHERTYPE_IPV4, ip: { src: host.ip, dst: dstIp }, app });
  }

  /**
   * @param {string} name
   * @param {string} ip
   */
  function timeout(name, ip) {
    const host = state.hosts[name];
    if (!host?.pending.has(ip) || host.arpCache.has(ip)) return;
    const dropped = host.pending.get(ip)?.length ?? 0;
    host.pending.delete(ip);
    emit('arp:timeout', { host: name, ip, time: state.clock });
    log(
      `No reply for ${ip}. A real host typically retries about 3 times, a second apart, then reports the ` +
        `destination unreachable. ${name} drops ${dropped === 1 ? 'the waiting packet' : `${dropped} waiting packets`}.`,
    );
  }

  /** Remove cache and MAC-table entries whose time is up. */
  function expire() {
    for (const host of Object.values(state.hosts)) {
      for (const [ip, entry] of host.arpCache) {
        if (entry.expiresAt <= state.clock) {
          host.arpCache.delete(ip);
          emit('cache:expire', { host: host.name, ip });
        }
      }
    }
    for (const [mac, entry] of state.switch.macTable) {
      if (entry.expiresAt <= state.clock) {
        state.switch.macTable.delete(mac);
        emit('mactable:expire', { mac, port: entry.port });
      }
    }
  }

  /**
   * An application on host `src` wants to reach `dstIp`.
   * @param {string} src
   * @param {string} dstIp
   * @param {App} [app]
   */
  function send(src, dstIp, app = 'ping') {
    const host = state.hosts[src];
    if (!host) throw new Error(`No host named ${src}`);
    const local = sameSubnet(host.ip, dstIp, host.prefix);

    if (!local && host.role === 'gateway') {
      log(`${src} routes ${APP_LABEL[app]} for ${dstIp} straight out its upstream link to the next hop.`);
      emit('frame:forward', { frame: null, node: src, to: 'next hop', time: state.clock });
      return;
    }
    if (!local && !GATEWAY) throw new Error('No gateway in the topology');
    const nextHop = local ? dstIp : /** @type {Node} */ (GATEWAY).ip;

    const cached = host.arpCache.get(nextHop);
    if (cached) {
      log(`${src} already has ${nextHop} in its ARP cache (${cached.mac}), so no ARP is needed.`);
      sendData(host, cached.mac, dstIp, app);
      return;
    }

    const why =
      `${src} wants to send ${APP_LABEL[app]} to ${dstIp}. The application knows only the IP address, but ` +
      `Ethernet delivers frames by MAC address, so ${src} needs a MAC to put in the frame.`;
    log(
      local
        ? `${why} ${dstIp} is on the local subnet and not in the ARP cache, so ${src} asks for it.`
        : `${why} ${dstIp} is not on the local subnet, so the frame goes to the default gateway, ` +
            `${GATEWAY?.name} (${nextHop}). ${src} asks for the gateway's MAC, not ${dstIp}'s.`,
    );

    const waiting = host.pending.get(nextHop);
    if (waiting) {
      waiting.push({ dstIp, app });
      log(`${src} is already asking for ${nextHop}; this packet waits for the same reply.`);
      return;
    }
    host.pending.set(nextHop, [{ dstIp, app }]);
    const request = transmit(host, {
      dst: BROADCAST_MAC,
      src: host.mac,
      type: ETHERTYPE_ARP,
      arp: { oper: ARP_REQUEST, sha: host.mac, spa: host.ip, tha: ZERO_MAC, tpa: nextHop },
    });
    floods.set(request.id, { host: src, ip: nextHop, remaining: Infinity, answered: false });
    log(`${src} broadcasts an ARP request: who has ${nextHop}? Tell ${host.ip}.`);
  }

  /**
   * Gratuitous ARP: a host announces its own address (sender IP = target IP, broadcast).
   * @param {string} name
   */
  function announce(name) {
    const host = state.hosts[name];
    if (!host) throw new Error(`No host named ${name}`);
    log(`${name} announces itself: ${host.ip} is at ${host.mac} (gratuitous ARP).`);
    transmit(host, {
      dst: BROADCAST_MAC,
      src: host.mac,
      type: ETHERTYPE_ARP,
      arp: { oper: ARP_REQUEST, sha: host.mac, spa: host.ip, tha: ZERO_MAC, tpa: host.ip },
    });
  }

  /**
   * "Meanwhile, on another host…": give a host an address and have it announce it.
   * @param {string} name
   * @param {string} ip
   */
  function claimIp(name, ip) {
    const host = state.hosts[name];
    if (!host) throw new Error(`No host named ${name}`);
    log(`Meanwhile, on ${name}, someone sets a static address of ${ip}.`);
    host.ip = ip;
    announce(name);
  }

  /**
   * Break it: an unsolicited ARP reply telling `victim` that `claimIp` is at the attacker's MAC.
   * @param {string} attackerName
   * @param {string} victimName
   * @param {string} claimIp
   */
  function spoof(attackerName, victimName, claimIp) {
    const attackerHost = state.hosts[attackerName];
    const victim = state.hosts[victimName];
    if (!attackerHost || !victim) throw new Error(`No host named ${attackerHost ? victimName : attackerName}`);
    log(`${attackerName} sends ${victimName} an ARP reply it never asked for: ${claimIp} is at ${attackerHost.mac}.`);
    transmit(attackerHost, {
      dst: victim.mac,
      src: attackerHost.mac,
      type: ETHERTYPE_ARP,
      arp: { oper: ARP_REPLY, sha: attackerHost.mac, spa: claimIp, tha: victim.mac, tpa: victim.ip },
    });
  }

  /** @param {number} ms Cache and MAC-table lifetime, kept within 10–300 s. */
  function setTtl(ms) {
    state.ttlMs = Math.min(MAX_TTL_MS, Math.max(MIN_TTL_MS, ms));
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
      expire();
      next.run();
    }
    state.clock = until;
    expire();
  }

  /** Run until nothing is left in flight. For tests and the Step control. */
  function runUntilIdle() {
    while (queue.length > 0) tick(Math.min(...queue.map((item) => item.at)) - state.clock);
  }

  /** True when no frame or timer is pending. */
  const isIdle = () => queue.length === 0;

  return { state, on, emit, send, announce, claimIp, spoof, setTtl, tick, runUntilIdle, isIdle };
}

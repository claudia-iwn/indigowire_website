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
 * @property {{ src: string, dst: string, ttl: number }} [ip]
 * @property {App} [app]
 * @property {boolean} [reply] Data frames: true for the answer (echo reply, web response, DNS answer).
 * @property {number} flow     Groups every frame of one send (request, reply, data), for the hop table.
 * @property {number} [parent] For a frame a router rebuilt: the id of the frame it came from.
 */

/**
 * @typedef {'frame:emit' | 'frame:arrive' | 'frame:drop' | 'frame:forward' | 'cache:update' | 'cache:expire'
 *   | 'mactable:update' | 'mactable:expire' | 'arp:timeout' | 'ip:conflict' | 'host:down' | 'log'} EngineEvent
 */

/**
 * An IP packet waiting to go out, with what the frame around it needs. `via` is the frame
 * a router received it in, when the router is forwarding rather than sending its own.
 * @typedef {{ ip: { src: string, dst: string, ttl: number }, app: App, reply: boolean, flow: number, via?: Frame }} Packet
 */

/** One switch, four ports in use, attacker only in Break-it mode. MACs from the RFC 7042 documentation range. */
export const TOPOLOGY = /** @type {const} */ ({
  switch: { name: 'SW1' },
  /** @type {Node[]} */
  nodes: [
    { name: 'H1', role: 'host', ip: '192.0.2.11', prefix: 24, mac: '00:00:5e:00:53:11', port: 'Gi0/1' },
    { name: 'H2', role: 'host', ip: '192.0.2.12', prefix: 24, mac: '00:00:5e:00:53:12', port: 'Gi0/2' },
    { name: 'H3', role: 'host', ip: '192.0.2.13', prefix: 24, mac: '00:00:5e:00:53:13', port: 'Gi0/3' },
    { name: 'R1', role: 'gateway', ip: '192.0.2.1', prefix: 24, mac: '00:00:5e:00:53:01', port: 'Gi0/4' },
    { name: 'M', role: 'attacker', ip: '192.0.2.66', prefix: 24, mac: '00:00:5e:00:53:66', port: 'Gi0/5' },
  ],
  // R1's other interface, toward the internet (RFC 5737 TEST-NET-2), and the router at the
  // far end of that link. R1 already knows the next hop's MAC; the game doesn't simulate that link's ARP.
  upstream: {
    ip: '198.51.100.1',
    mac: '00:00:5e:00:53:a1',
    nextHop: { name: 'next hop', ip: '198.51.100.254', mac: '00:00:5e:00:53:fe' },
  },
});

export const DEFAULT_TTL_MS = 60_000;
export const MIN_TTL_MS = 10_000;
export const MAX_TTL_MS = 300_000;
/** Simulated time for a frame to cross one link. */
export const HOP_MS = 600;
/** How long a host waits for a reply once its request has reached every host. */
export const ARP_TIMEOUT_MS = 1_000;
/** IP time-to-live a host puts on a new packet; each router lowers it by one. */
export const IP_TTL = 64;
/** Routers a reply from the internet is taken to have crossed before the next hop (illustrative). */
export const INTERNET_HOPS = 8;

const SWITCH = TOPOLOGY.switch.name;
const GATEWAY = TOPOLOGY.nodes.find((node) => node.role === 'gateway');

/** @type {Record<App, string>} */
const APP_LABEL = {
  ping: 'a ping (ICMP echo request)',
  web: 'a web request (HTTP over TCP)',
  dns: 'a DNS query (UDP)',
};
/** @type {Record<App, string>} */
const REPLY_LABEL = {
  ping: 'the ICMP echo reply',
  web: 'the web response',
  dns: 'the DNS answer',
};
/** @param {{ app?: App, reply?: boolean }} packet */
const labelOf = ({ app = 'ping', reply }) => (reply ? REPLY_LABEL[app] : APP_LABEL[app]);

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
          /** @type {Map<string, Packet[]>} */
          pending: new Map(),
          /** True once the host has failed (Gratuitous ARP mode's failover). */
          down: false,
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
  let nextFlow = 1;
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
    return transmitFrame(host, /** @type {Frame} */ ({ id: nextFrameId++, ...fields }));
  }

  /**
   * @param {Host} host
   * @param {Frame} frame  Already numbered.
   */
  function transmitFrame(host, frame) {
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
    // Either way the frame leaves exactly as it arrived: a switch never rewrites it.
    let how = 'forward';
    // A failed host's port is down, so nothing goes out of it.
    const others = Object.values(state.hosts).filter((host) => host.port !== ingress && !host.down);
    if (frame.dst === BROADCAST_MAC) {
      how = 'flood';
      outs = others;
      log(`${SWITCH} floods the broadcast out every other port.`);
    } else if (!entry) {
      how = 'flood';
      outs = others;
      log(`${SWITCH} has no entry for ${frame.dst}, so it floods the frame out every other port.`);
    } else {
      const out = nodeByPort(entry.port);
      outs = out && entry.port !== ingress ? [out] : [];
      if (out) log(`${SWITCH} knows ${frame.dst} is on ${entry.port} and forwards the frame only there.`);
    }

    const flood = floods.get(frame.id);
    if (flood) flood.remaining = outs.length;
    for (const host of outs) {
      emit('frame:emit', { frame, from: SWITCH, to: host.name, how, at: state.clock, arrivesAt: state.clock + HOP_MS });
      schedule(HOP_MS, () => hostReceive(host, frame));
    }
  }

  /**
   * @param {Host} host
   * @param {Frame} frame
   */
  function hostReceive(host, frame) {
    emit('frame:arrive', { frame, node: host.name, time: state.clock });
    if (host.down) return;
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
        flow: frame.flow,
      });
    } else if (oper === ARP_REPLY && tpa === host.ip) {
      if (!had) cache(host, spa, sha);
      log(`${host.name} learns that ${spa} is at ${sha}.`);
      const waiting = host.pending.get(spa) ?? [];
      host.pending.delete(spa);
      for (const packet of waiting) sendData(host, sha, packet);
    } else if (!had) {
      drop(host, frame, 'not for me');
    }
  }

  /**
   * @param {Host} host
   * @param {Frame} frame
   */
  function receiveData(host, frame) {
    const { ip, app = 'ping', reply = false } = frame;
    if (!ip) return;
    if (ip.dst === host.ip) {
      log(`${host.name} receives ${labelOf(frame)} from ${ip.src}.`);
      if (!reply) answer(host, frame);
    } else if (host.role === 'gateway') {
      const { upstream } = TOPOLOGY;
      const out = /** @type {Frame} */ ({
        id: nextFrameId++,
        dst: upstream.nextHop.mac,
        src: upstream.mac,
        type: ETHERTYPE_IPV4,
        ip: { ...ip, ttl: ip.ttl - 1 },
        app,
        reply,
        flow: frame.flow,
        parent: frame.id,
      });
      emit('frame:forward', { frame, out, node: host.name, to: upstream.nextHop.name, time: state.clock });
      log(
        `${host.name} removes the Ethernet header, looks up a route to ${ip.dst}, lowers the TTL from ${ip.ttl} to ` +
          `${ip.ttl - 1} and builds a new frame for its upstream link: from its own MAC ${upstream.mac} to the next ` +
          `hop's ${upstream.nextHop.mac}. The MAC addresses change at every hop; the IP addresses stay ${ip.src} → ${ip.dst}.`,
      );
      routeOut(host, out);
    } else {
      drop(host, frame, 'not for me');
    }
  }

  /**
   * The destination answers: an echo reply, a web response or a DNS answer, sent back the
   * same way any packet is (ARP first if the host doesn't know the next hop's MAC).
   * @param {Host} host
   * @param {Frame} request
   */
  function answer(host, request) {
    const ip = /** @type {NonNullable<Frame['ip']>} */ (request.ip);
    const packet = {
      ip: { src: host.ip, dst: ip.src, ttl: IP_TTL },
      app: request.app ?? 'ping',
      reply: true,
      flow: request.flow,
    };
    const local = sameSubnet(host.ip, ip.src, host.prefix);
    if (!local && !GATEWAY) return;
    deliver(host, local ? ip.src : /** @type {Node} */ (GATEWAY).ip, packet);
  }

  /**
   * Send a packet to `nextHop` on the LAN: at once on a cache hit, otherwise after ARP.
   * @param {Host} host
   * @param {string} nextHop  IP whose MAC goes in the frame.
   * @param {Packet} packet
   * @returns {boolean} True when the packet went out at once.
   */
  function deliver(host, nextHop, packet) {
    const cached = host.arpCache.get(nextHop);
    if (cached) {
      sendData(host, cached.mac, packet);
      return true;
    }
    const waiting = host.pending.get(nextHop);
    if (waiting) {
      waiting.push(packet);
      log(`${host.name} is already asking for ${nextHop}; this packet waits for the same reply.`);
      return false;
    }
    host.pending.set(nextHop, [packet]);
    const request = transmit(host, {
      dst: BROADCAST_MAC,
      src: host.mac,
      type: ETHERTYPE_ARP,
      arp: { oper: ARP_REQUEST, sha: host.mac, spa: host.ip, tha: ZERO_MAC, tpa: nextHop },
      flow: packet.flow,
    });
    floods.set(request.id, { host: host.name, ip: nextHop, remaining: Infinity, answered: false });
    log(`${host.name} broadcasts an ARP request: who has ${nextHop}? Tell ${host.ip}.`);
    return false;
  }

  /**
   * @param {Host} host
   * @param {string} mac   Next hop's MAC.
   * @param {Packet} packet
   */
  function sendData(host, mac, packet) {
    const { ip, app, reply, flow, via } = packet;
    const frame = /** @type {Frame} */ ({
      id: nextFrameId++,
      dst: mac,
      src: host.mac,
      type: ETHERTYPE_IPV4,
      ip,
      app,
      reply,
      flow,
      ...(via ? { parent: via.id } : {}), // like Python's {**({'parent': ...} if via else {})}
    });
    if (via) {
      const to = Object.values(state.hosts).find((h) => h.mac === mac)?.name ?? mac;
      emit('frame:forward', { frame: via, out: frame, node: host.name, to, time: state.clock });
      log(
        `${host.name} removes the upstream Ethernet header, lowers the TTL from ${via.ip?.ttl} to ${ip.ttl} and ` +
          `builds a new frame for the LAN: from its own MAC ${host.mac} to ${to}'s ${mac}. The IP addresses stay ` +
          `${ip.src} → ${ip.dst}.`,
      );
    } else {
      log(`${host.name} sends ${labelOf(packet)} to ${ip.dst} in a frame addressed to ${mac}.`);
    }
    transmitFrame(host, frame);
  }

  /**
   * Send a frame out R1's upstream link. At the next hop a request is answered: the reply
   * comes back from "the internet" to R1.
   * @param {Host} router
   * @param {Frame} frame
   */
  function routeOut(router, frame) {
    const { upstream } = TOPOLOGY;
    const to = upstream.nextHop.name;
    emit('frame:emit', { frame, from: router.name, to, at: state.clock, arrivesAt: state.clock + HOP_MS });
    schedule(HOP_MS, () => {
      emit('frame:arrive', { frame, node: to, time: state.clock });
      const ip = /** @type {NonNullable<Frame['ip']>} */ (frame.ip);
      if (frame.reply) return;
      const back = /** @type {Frame} */ ({
        id: nextFrameId++,
        dst: upstream.mac,
        src: upstream.nextHop.mac,
        type: ETHERTYPE_IPV4,
        ip: { src: ip.dst, dst: ip.src, ttl: IP_TTL - INTERNET_HOPS },
        app: frame.app,
        reply: true,
        flow: frame.flow,
      });
      log(
        `${labelOf(back)} from ${ip.dst} comes back across the internet to the next hop, which sends it to ${router.name}.`,
      );
      emit('frame:emit', { frame: back, from: to, to: router.name, at: state.clock, arrivesAt: state.clock + HOP_MS });
      schedule(HOP_MS, () => upstreamReceive(router, back));
    });
  }

  /**
   * R1 receives a packet on its upstream link and routes it onto the LAN.
   * @param {Host} router
   * @param {Frame} frame
   */
  function upstreamReceive(router, frame) {
    emit('frame:arrive', { frame, node: router.name, time: state.clock });
    const ip = /** @type {NonNullable<Frame['ip']>} */ (frame.ip);
    if (ip.dst === TOPOLOGY.upstream.ip) {
      log(`${router.name} receives ${labelOf(frame)} from ${ip.src}.`);
      return;
    }
    if (!sameSubnet(router.ip, ip.dst, router.prefix)) return;
    const packet = {
      ip: { ...ip, ttl: ip.ttl - 1 },
      app: frame.app ?? 'ping',
      reply: Boolean(frame.reply),
      flow: frame.flow,
      via: frame,
    };
    if (!router.arpCache.has(ip.dst)) {
      log(`${router.name} has a packet for ${ip.dst} on its LAN but no MAC for it, so it uses ARP too.`);
    }
    deliver(router, ip.dst, packet);
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
    if (host.down) {
      log(`${src} is down, so it sends nothing.`);
      return;
    }
    const local = sameSubnet(host.ip, dstIp, host.prefix);

    const flow = nextFlow++;
    if (!local && host.role === 'gateway') {
      const { upstream } = TOPOLOGY;
      log(`${src} routes ${APP_LABEL[app]} for ${dstIp} straight out its upstream link to the next hop.`);
      routeOut(host, {
        id: nextFrameId++,
        dst: upstream.nextHop.mac,
        src: upstream.mac,
        type: ETHERTYPE_IPV4,
        ip: { src: upstream.ip, dst: dstIp, ttl: IP_TTL },
        app,
        flow,
      });
      return;
    }
    if (!local && !GATEWAY) throw new Error('No gateway in the topology');
    const nextHop = local ? dstIp : /** @type {Node} */ (GATEWAY).ip;

    const packet = { ip: { src: host.ip, dst: dstIp, ttl: IP_TTL }, app, reply: false, flow };
    const cached = host.arpCache.get(nextHop);
    if (cached) {
      log(`${src} already has ${nextHop} in its ARP cache (${cached.mac}), so no ARP is needed.`);
      sendData(host, cached.mac, packet);
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
    deliver(host, nextHop, packet);
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
      flow: nextFlow++,
    });
  }

  /**
   * Give a host an address and have it announce it: "Meanwhile, on another host…" (a
   * mistyped static IP) or a failover (a standby taking over a failed host's address).
   * @param {string} name
   * @param {string} ip
   * @param {string} [why]  The log line saying how the host came to claim it.
   */
  function claimIp(name, ip, why = `Meanwhile, on ${name}, someone sets a static address of ${ip}.`) {
    const host = state.hosts[name];
    if (!host) throw new Error(`No host named ${name}`);
    log(why);
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
      flow: nextFlow++,
    });
  }

  /**
   * Failover: a host fails. Its switch port goes down, so SW1 forgets the MACs it learnt
   * there and sends it nothing more.
   * @param {string} name
   */
  function fail(name) {
    const host = state.hosts[name];
    if (!host) throw new Error(`No host named ${name}`);
    host.down = true;
    emit('host:down', { host: name, time: state.clock });
    log(`${name} fails. ${SWITCH} sees its port ${host.port} go down and forgets the MAC addresses learnt there.`);
    for (const [mac, entry] of state.switch.macTable) {
      if (entry.port !== host.port) continue;
      state.switch.macTable.delete(mac);
      emit('mactable:expire', { mac, port: entry.port });
    }
  }

  /**
   * Fill in a cache entry from the topology, as if the hosts had talked a moment ago.
   * Scenarios use it to start from warm caches.
   * @param {string} name
   * @param {string} ip
   */
  function primeCache(name, ip) {
    const host = state.hosts[name];
    const owner = Object.values(state.hosts).find((h) => h.ip === ip);
    if (!host || !owner) throw new Error(`Cannot prime ${name} with ${ip}`);
    cache(host, ip, owner.mac);
    log(`${name} already has ${ip} at ${owner.mac} in its cache from earlier traffic.`);
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

  /** Simulated time of the next queued action, or null when idle. The Step control ticks to it. */
  const nextEventAt = () => (queue.length ? Math.min(...queue.map((item) => item.at)) : null);

  /** True when no frame or timer is pending. */
  const isIdle = () => queue.length === 0;

  return {
    state,
    on,
    emit,
    send,
    announce,
    claimIp,
    spoof,
    fail,
    primeCache,
    setTtl,
    tick,
    runUntilIdle,
    isIdle,
    nextEventAt,
  };
}

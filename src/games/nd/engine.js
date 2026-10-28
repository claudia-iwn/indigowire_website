/**
 * IPv6 Neighbor Discovery simulation engine (spec section 13). DOM-free: no window, no document.
 * Built on the shared LAN core (src/games/lan/): the clock, SW1, the network cards and R1's
 * upstream link are the ARP game's; this file adds Neighbor Discovery (RFC 4861) and, in
 * Task 5, Duplicate Address Detection (RFC 4862).
 *
 * Time is simulated and kept by the shared core: every hop takes HOP_MS, and tick(ms) runs
 * whatever falls due, in order, so tests run a whole exchange instantly.
 */
import { createSim } from '../lan/sim.js';
import { createSwitch } from '../lan/switch.js';
import { nicDrop } from '../lan/nic.js';
import { createUpstream } from '../lan/upstream.js';
import { ETHERTYPE_IPV6, ND_NA, ND_NS } from './frames.js';
import { ALL_NODES, ALL_ROUTERS, isLinkLocal, multicastMac, normalize, samePrefix64, solicitedNode } from './ipv6.js';

/**
 * @typedef {'ping' | 'web' | 'dns'} App
 * @typedef {import('./frames.js').NdFrame} Frame
 * @typedef {{ mac: string, state: 'REACHABLE' | 'STALE', reachableUntil?: number }} Neighbor
 * @typedef {{ ip: { src: string, dst: string, ttl: number }, app: App, reply: boolean, flow: number, via?: Frame }} Packet
 */

/** The same LAN as the ARP game (section 6), in IPv6. MACs from the RFC 7042 documentation range. */
export const TOPOLOGY = /** @type {const} */ ({
  switch: { name: 'SW1' },
  /** The link's /64: every global address here starts with it. */
  prefix: '2001:db8:0:1::',
  nodes: [
    {
      name: 'H1',
      role: 'host',
      global: '2001:db8:0:1::11',
      linkLocal: 'fe80::11',
      mac: '00:00:5e:00:53:11',
      port: 'Gi0/1',
    },
    {
      name: 'H2',
      role: 'host',
      global: '2001:db8:0:1::12',
      linkLocal: 'fe80::12',
      mac: '00:00:5e:00:53:12',
      port: 'Gi0/2',
    },
    {
      name: 'H3',
      role: 'host',
      global: '2001:db8:0:1::13',
      linkLocal: 'fe80::13',
      mac: '00:00:5e:00:53:13',
      port: 'Gi0/3',
    },
    {
      name: 'R1',
      role: 'gateway',
      global: '2001:db8:0:1::1',
      linkLocal: 'fe80::1',
      mac: '00:00:5e:00:53:01',
      port: 'Gi0/4',
    },
  ],
  // R1's other interface, toward the internet, and the router at the far end of that link,
  // which R1 already knows: the game doesn't simulate Neighbor Discovery on that link.
  upstream: {
    ip: '2001:db8:0:ff::1',
    mac: '00:00:5e:00:53:a1',
    nextHop: { name: 'next hop', ip: 'fe80::fe', mac: '00:00:5e:00:53:fe' },
  },
});

/** How long an answered neighbour stays REACHABLE (RFC 4861's ReachableTime is 15–45 s, about 30). */
export const DEFAULT_REACHABLE_MS = 30_000;
export const MIN_REACHABLE_MS = 10_000;
export const MAX_REACHABLE_MS = 300_000;
/** SW1's MAC table ageing, as in the ARP game's default. */
export const MAC_AGE_MS = 60_000;
/** Simulated time for a frame to cross one link. */
export const HOP_MS = 600;
/** RFC 4861's RetransTimer: the wait between solicitations, and DAD's wait for a defence. */
export const RETRANS_MS = 1_000;
/** A request and its answer cross four links: the timers start counting after that. */
export const ROUND_TRIP_MS = 4 * HOP_MS;
/** MAX_MULTICAST_SOLICIT and MAX_UNICAST_SOLICIT. */
export const MAX_SOLICIT = 3;
/** The hop limit a host puts on a new packet; each router lowers it by one. */
export const HOP_LIMIT = 64;
/** Neighbor Discovery is always sent with 255 and must arrive with 255 (RFC 4861 §7.1). */
export const ND_HOP_LIMIT = 255;
/** Routers an answer from the internet is taken to have crossed before the next hop (illustrative). */
export const INTERNET_HOPS = 8;
/** Real hosts learn this from R1's Router Advertisements; the game gives it to them. */
export const DEFAULT_ROUTER = 'fe80::1';

const SWITCH = TOPOLOGY.switch.name;
const ALL_NODES_MAC = multicastMac(ALL_NODES);
const ALL_ROUTERS_MAC = multicastMac(ALL_ROUTERS);

/** @type {Record<App, string>} */
const APP_LABEL = {
  ping: 'a ping (ICMPv6 echo request)',
  web: 'a web request (HTTP over TCP)',
  dns: 'a DNS query (UDP)',
};
/** @type {Record<App, string>} */
const REPLY_LABEL = { ping: 'the ICMPv6 echo reply', web: 'the web response', dns: 'the DNS answer' };
/** @param {{ app?: App, reply?: boolean }} packet */
const labelOf = ({ app = 'ping', reply }) => (reply ? REPLY_LABEL[app] : APP_LABEL[app]);

/**
 * Why a host would refuse a Neighbor Discovery frame, or null when it accepts it: only hop
 * limit 255 proves the frame was sent on this link, not routed in from elsewhere.
 * @param {{ ip: { ttl: number } }} frame
 */
export function checkNd(frame) {
  return frame.ip.ttl === ND_HOP_LIMIT ? null : 'hop limit not 255';
}

/**
 * Create a fresh simulation. To reset, create a new one.
 * @param {{ reachableMs?: number }} [options]
 */
export function createEngine({ reachableMs = DEFAULT_REACHABLE_MS } = {}) {
  const state = {
    clock: 0,
    reachableMs,
    hosts: Object.fromEntries(
      TOPOLOGY.nodes.map((node) => [
        node.name,
        {
          ...node,
          /** @type {string | null} The usable global address; null during DAD, or after DAD failed. */
          global: /** @type {string | null} */ (node.global),
          /** @type {string | null} An address DAD is still checking, not yet usable. */
          tentative: /** @type {string | null} */ (null),
          /** @type {string | null} An address DAD found in use by another device. */
          duplicate: /** @type {string | null} */ (null),
          /** @type {Set<string>} Multicast MACs the network card listens to. */
          groups: new Set(),
          /** @type {Map<string, Neighbor>} The neighbour cache: address -> entry, like a dict of dicts. */
          neighbors: new Map(),
          /** @type {Map<string, Packet[]>} Addresses being asked for, and the packets waiting for the answer. */
          pending: new Map(),
          /** @type {Set<string>} Neighbours being checked with a unicast solicitation. */
          probing: new Set(),
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

  // The clock, timed actions, events and log are shared with the other LAN games.
  const sim = createSim(state, { onAdvance: expire });
  const { on, emit, log, schedule } = sim;
  const sw = createSwitch(sim, {
    name: SWITCH,
    table: state.switch.macTable,
    devices: () => Object.values(state.hosts),
    ttlMs: () => MAC_AGE_MS,
    hopMs: HOP_MS,
    deliver: hostReceive,
  });
  const uplink = createUpstream(sim, {
    link: TOPOLOGY.upstream,
    etherType: ETHERTYPE_IPV6,
    hopName: 'Hop limit',
    ipTtl: HOP_LIMIT,
    internetHops: INTERNET_HOPS,
    hopMs: HOP_MS,
    labelOf,
    onLan: fromUpstream,
  });
  for (const host of Object.values(state.hosts)) joinGroups(host);

  /** @param {string} name */
  function hostNamed(name) {
    const host = state.hosts[name];
    if (!host) throw new Error(`No host named ${name}`);
    return host;
  }

  /**
   * The groups a card listens to: all nodes, all routers on R1, and the solicited-node group
   * of each of its addresses (a tentative one too, so DAD hears a defence).
   * @param {Host} host
   */
  function joinGroups(host) {
    const addresses = [host.global, host.linkLocal, host.tentative].filter((a) => a !== null);
    host.groups = new Set([
      ALL_NODES_MAC,
      ...(host.role === 'gateway' ? [ALL_ROUTERS_MAC] : []),
      ...addresses.map((addr) => multicastMac(solicitedNode(addr))),
    ]);
  }

  /** @param {Host} host @param {string} addr */
  const owns = (host, addr) => addr === host.global || addr === host.linkLocal;
  /** @param {string} addr  On this link: link-local, or inside the link's /64. */
  const onLink = (addr) => isLinkLocal(addr) || samePrefix64(addr, TOPOLOGY.prefix);
  /** @param {Host} host @param {string} dst  The source address to use toward `dst`. */
  const sourceFor = (host, dst) => (isLinkLocal(dst) || host.global === null ? host.linkLocal : host.global);
  /** @param {string} dst */
  const nextHopFor = (dst) => (onLink(dst) ? dst : DEFAULT_ROUTER);
  /** @param {string} mac */
  const nameOfMac = (mac) => Object.values(state.hosts).find((h) => h.mac === mac)?.name ?? mac;

  /**
   * Put a new frame on a host's link toward the switch.
   * @param {Host} host
   * @param {Omit<Frame, 'id'>} fields
   */
  function transmit(host, fields) {
    return transmitFrame(host, /** @type {Frame} */ ({ id: sim.frameId(), ...fields }));
  }

  /** @param {Host} host @param {Frame} frame */
  function transmitFrame(host, frame) {
    emit('frame:emit', { frame, from: host.name, to: SWITCH, at: state.clock, arrivesAt: state.clock + HOP_MS });
    schedule(HOP_MS, () => sw.receive(frame, host.port));
    return frame;
  }

  /** @param {Host} host @param {Frame} frame @param {string} reason */
  function drop(host, frame, reason) {
    emit('frame:drop', { frame, node: host.name, reason, time: state.clock });
  }

  /** @param {Host} host @param {Frame} frame */
  function hostReceive(host, frame) {
    emit('frame:arrive', { frame, node: host.name, time: state.clock });
    if (host.down) return;
    const reason = nicDrop(host, frame.dst);
    if (reason) return drop(host, frame, reason);
    if (frame.nd) {
      const refused = checkNd(frame);
      if (refused) return drop(host, frame, refused);
      return frame.nd.type === ND_NS ? receiveSolicitation(host, frame) : receiveAdvertisement(host, frame);
    }
    receiveData(host, frame);
  }

  /**
   * Add or change a neighbour cache entry.
   * @param {Host} host
   * @param {string} addr
   * @param {string} mac
   * @param {'REACHABLE' | 'STALE'} entryState
   */
  function setNeighbor(host, addr, mac, entryState) {
    /** @type {Neighbor} */
    const entry =
      entryState === 'REACHABLE'
        ? { mac, state: entryState, reachableUntil: state.clock + state.reachableMs }
        : { mac, state: entryState };
    host.neighbors.set(addr, entry);
    emit('cache:update', { host: host.name, ip: addr, mac, state: entryState, expiresAt: entry.reachableUntil });
  }

  /**
   * A Neighbor Solicitation for one of the host's addresses: note the asker, answer it.
   * @param {Host} host
   * @param {Frame} frame
   */
  function receiveSolicitation(host, frame) {
    const nd = /** @type {import('./frames.js').NdMessage} */ (frame.nd);
    const { ip } = frame;
    if (!owns(host, nd.target)) return drop(host, frame, 'not my address');
    const check = ip.dst === nd.target; // unicast to the address itself: a reachability check
    if (nd.lla) {
      const had = host.neighbors.get(ip.src);
      // RFC 4861 §7.2.3: a new or changed MAC is STALE; the same MAC keeps its state.
      if (!had || had.mac !== nd.lla) setNeighbor(host, ip.src, nd.lla, 'STALE');
    }
    log(
      check
        ? `${host.name} answers ${ip.src}'s check: ${nd.target} is still here, at ${host.mac}.`
        : `${host.name} has ${nd.target}. It notes that ${ip.src} is at ${nd.lla} as STALE (a solicitation proves nothing about the way back) and answers straight to ${ip.src}.`,
    );
    transmit(host, {
      dst: nd.lla ?? frame.src,
      src: host.mac,
      type: ETHERTYPE_IPV6,
      ip: { src: nd.target, dst: ip.src, ttl: ND_HOP_LIMIT },
      nd: {
        type: ND_NA,
        target: nd.target,
        lla: host.mac,
        router: host.role === 'gateway',
        solicited: true,
        override: true,
      },
      flow: frame.flow,
    });
  }

  /**
   * A Neighbor Advertisement: the answer the host was waiting for, or one it didn't ask for.
   * @param {Host} host
   * @param {Frame} frame
   */
  function receiveAdvertisement(host, frame) {
    const nd = /** @type {import('./frames.js').NdMessage} */ (frame.nd);
    const lla = /** @type {string} */ (nd.lla);
    const asked = host.pending.has(nd.target) || host.probing.has(nd.target);
    // RFC 4861 §7.2.5: an answer to a question nobody asked changes nothing.
    if (!asked) return drop(host, frame, 'not asked');
    setNeighbor(host, nd.target, lla, 'REACHABLE');
    if (host.probing.delete(nd.target)) {
      log(`${host.name}'s check is answered: ${nd.target} is REACHABLE again.`);
    } else {
      log(
        `${host.name} learns that ${nd.target} is at ${lla}: REACHABLE, because this answer proves the way back works too.`,
      );
    }
    const waiting = host.pending.get(nd.target) ?? [];
    host.pending.delete(nd.target);
    for (const packet of waiting) sendData(host, lla, packet);
  }

  /** @param {Host} host @param {Frame} frame */
  function receiveData(host, frame) {
    const { ip, reply = false } = frame;
    if (owns(host, ip.dst)) {
      log(`${host.name} receives ${labelOf(frame)} from ${ip.src}.`);
      if (!reply) answer(host, frame);
    } else if (host.role === 'gateway' && !onLink(ip.dst)) {
      uplink.forward(host, /** @type {any} */ (frame));
    } else {
      drop(host, frame, 'not for me');
    }
  }

  /**
   * The destination answers: an echo reply, a web response or a DNS answer, from the
   * address the request was sent to.
   * @param {Host} host
   * @param {Frame} request
   */
  function answer(host, request) {
    /** @type {Packet} */
    const packet = {
      ip: { src: request.ip.dst, dst: request.ip.src, ttl: HOP_LIMIT },
      app: request.app ?? 'ping',
      reply: true,
      flow: request.flow,
    };
    deliver(host, nextHopFor(request.ip.src), packet);
  }

  /**
   * Send a packet to `nextHop` on the link: at once with a cache entry (checking a STALE one
   * afterwards), otherwise after Neighbor Discovery.
   * @param {Host} host
   * @param {string} nextHop
   * @param {Packet} packet
   */
  function deliver(host, nextHop, packet) {
    const entry = host.neighbors.get(nextHop);
    if (entry) {
      const stale = entry.state === 'STALE';
      if (stale) {
        log(
          `${host.name} has ${nextHop} in its neighbor cache, but STALE: it sends the packet to ${entry.mac} at once, then checks the neighbor is still there. (Real hosts wait 5 seconds first: the DELAY state.)`,
        );
      }
      sendData(host, entry.mac, packet);
      if (stale && !host.probing.has(nextHop)) check(host, nextHop, entry.mac, packet.flow);
      return;
    }
    const waiting = host.pending.get(nextHop);
    if (waiting) {
      waiting.push(packet);
      log(`${host.name} is already asking for ${nextHop}; this packet waits for the same answer.`);
      return;
    }
    host.pending.set(nextHop, [packet]);
    solicit(host, nextHop, packet.ip.src, packet.flow, 1);
  }

  /**
   * Ask the target's solicited-node group for its MAC; ask again a second later, up to 3 times.
   * @param {Host} host
   * @param {string} target
   * @param {string} src  The address the waiting packet uses (RFC 4861 §7.2.2).
   * @param {number} flow
   * @param {number} attempt
   */
  function solicit(host, target, src, flow, attempt) {
    const group = solicitedNode(target);
    transmit(host, {
      dst: multicastMac(group),
      src: host.mac,
      type: ETHERTYPE_IPV6,
      ip: { src, dst: group, ttl: ND_HOP_LIMIT },
      nd: { type: ND_NS, target, lla: host.mac },
      flow,
    });
    log(
      attempt === 1
        ? `${host.name} sends a Neighbor Solicitation to ${target}'s solicited-node group, ${group} (${multicastMac(group)}): who has ${target}? Its own MAC rides along, so the answer can come straight back.`
        : `No answer yet: ${host.name} asks for ${target} again (try ${attempt} of ${MAX_SOLICIT}).`,
    );
    schedule(ROUND_TRIP_MS + RETRANS_MS, () => {
      if (!host.pending.has(target)) return;
      if (attempt < MAX_SOLICIT) return solicit(host, target, src, flow, attempt + 1);
      const dropped = host.pending.get(target)?.length ?? 0;
      host.pending.delete(target);
      emit('nd:unreachable', { host: host.name, ip: target, time: state.clock });
      log(
        `No answer for ${target} after ${MAX_SOLICIT} Neighbor Solicitations, a second apart. ${host.name} gives up: ${dropped === 1 ? 'the waiting packet is' : `${dropped} waiting packets are`} dropped, and the application gets "address unreachable" (ICMPv6 type 1, code 3).`,
      );
    });
  }

  /**
   * Check a STALE neighbour with a solicitation sent straight to it; delete the entry after
   * 3 unanswered checks.
   * @param {Host} host
   * @param {string} target
   * @param {string} mac
   * @param {number} flow
   * @param {number} [attempt]
   */
  function check(host, target, mac, flow, attempt = 1) {
    host.probing.add(target);
    transmit(host, {
      dst: mac,
      src: host.mac,
      type: ETHERTYPE_IPV6,
      ip: { src: sourceFor(host, target), dst: target, ttl: ND_HOP_LIMIT },
      nd: { type: ND_NS, target, lla: host.mac },
      flow,
    });
    log(
      attempt === 1
        ? `${host.name} checks that ${target} is still at ${mac}: a Neighbor Solicitation sent straight to it.`
        : `No answer yet: ${host.name} checks ${target} again (try ${attempt} of ${MAX_SOLICIT}).`,
    );
    schedule(ROUND_TRIP_MS + RETRANS_MS, () => {
      if (!host.probing.has(target)) return;
      if (attempt < MAX_SOLICIT) return check(host, target, mac, flow, attempt + 1);
      host.probing.delete(target);
      host.neighbors.delete(target);
      emit('cache:expire', { host: host.name, ip: target });
      log(`${target} didn't answer ${MAX_SOLICIT} checks, so ${host.name} deletes its neighbor cache entry.`);
    });
  }

  /**
   * @param {Host} host
   * @param {string} mac  The next hop's MAC.
   * @param {Packet} packet
   */
  function sendData(host, mac, packet) {
    const { ip, app, reply, flow, via } = packet;
    const frame = /** @type {Frame} */ ({
      id: sim.frameId(),
      dst: mac,
      src: host.mac,
      type: ETHERTYPE_IPV6,
      ip,
      app,
      reply,
      flow,
      ...(via ? { parent: via.id } : {}), // like Python's {**({'parent': ...} if via else {})}
    });
    if (via) {
      const to = nameOfMac(mac);
      emit('frame:forward', { frame: via, out: frame, node: host.name, to, time: state.clock });
      log(
        `${host.name} removes the upstream Ethernet header, lowers the hop limit from ${via.ip.ttl} to ${ip.ttl} and ` +
          `builds a new frame for the LAN: from its own MAC ${host.mac} to ${to}'s ${mac}. The IPv6 addresses stay ${ip.src} → ${ip.dst}.`,
      );
    } else {
      log(`${host.name} sends ${labelOf(packet)} to ${ip.dst} in a frame addressed to ${mac}.`);
    }
    transmitFrame(host, frame);
  }

  /**
   * An answer from the internet for the LAN: R1 routes it on, with Neighbor Discovery first if it must.
   * @param {Host} router
   * @param {Frame} frame
   */
  function fromUpstream(router, frame) {
    const { ip } = frame;
    if (!onLink(ip.dst)) return;
    /** @type {Packet} */
    const packet = {
      ip: { ...ip, ttl: ip.ttl - 1 },
      app: frame.app ?? 'ping',
      reply: Boolean(frame.reply),
      flow: frame.flow,
      via: frame,
    };
    if (!router.neighbors.has(ip.dst)) {
      log(`${router.name} has a packet for ${ip.dst} on its LAN but no MAC for it, so it uses Neighbor Discovery too.`);
    }
    deliver(router, ip.dst, packet);
  }

  /** REACHABLE entries whose time is up turn STALE; MAC-table entries expire. */
  function expire() {
    for (const host of Object.values(state.hosts)) {
      for (const [addr, entry] of host.neighbors) {
        if (entry.state === 'REACHABLE' && /** @type {number} */ (entry.reachableUntil) <= state.clock) {
          host.neighbors.set(addr, { mac: entry.mac, state: 'STALE' });
          emit('cache:stale', { host: host.name, ip: addr });
        }
      }
    }
    sw.expire();
  }

  /**
   * An application on host `src` wants to reach `dst` (any valid IPv6 spelling).
   * @param {string} src
   * @param {string} dstText
   * @param {App} [app]
   */
  function send(src, dstText, app = 'ping') {
    const host = hostNamed(src);
    const dst = normalize(dstText);
    if (!dst) throw new Error(`Not an IPv6 address: ${dstText}`);
    if (host.down) {
      log(`${src} is down, so it sends nothing.`);
      return;
    }
    if (owns(host, dst)) {
      log(`${dst} is ${src}'s own address: nothing needs to go on the wire.`);
      return;
    }
    const flow = sim.flowId();
    const local = onLink(dst);
    if (!local && host.role === 'gateway') {
      uplink.originate(host, dst, app, flow);
      return;
    }
    const nextHop = nextHopFor(dst);
    /** @type {Packet} */
    const packet = { ip: { src: sourceFor(host, dst), dst, ttl: HOP_LIMIT }, app, reply: false, flow };
    const entry = host.neighbors.get(nextHop);
    if (entry?.state === 'REACHABLE') {
      log(
        `${src} already has ${nextHop} in its neighbor cache (${entry.mac}, REACHABLE), so no Neighbor Discovery is needed.`,
      );
      sendData(host, entry.mac, packet);
      return;
    }
    if (!entry) {
      const why =
        `${src} wants to send ${APP_LABEL[app]} to ${dst}. The application knows only the IPv6 address, but ` +
        `Ethernet delivers frames by MAC address, so ${src} needs a MAC to put in the frame.`;
      log(
        local
          ? `${why} ${dst} is on this link and not in ${src}'s neighbor cache, so ${src} asks for it with Neighbor Discovery.`
          : `${why} ${dst} is not on this link, so the packet goes to the default router, R1 (${DEFAULT_ROUTER}). ` +
              `${src} asks for the router's MAC, not ${dst}'s. Real hosts learn their default router from R1's Router Advertisements.`,
      );
    }
    deliver(host, nextHop, packet);
  }

  /**
   * A host fails: its switch port goes down, so SW1 forgets the MACs it learnt there.
   * @param {string} name
   */
  function fail(name) {
    const host = hostNamed(name);
    host.down = true;
    emit('host:down', { host: name, time: state.clock });
    log(`${name} fails. ${SWITCH} sees its port ${host.port} go down and forgets the MAC addresses learnt there.`);
    sw.forgetPort(host.port);
  }

  /**
   * Fill in a REACHABLE cache entry from the topology, as if the hosts had just talked.
   * @param {string} name
   * @param {string} addrText
   */
  function primeCache(name, addrText) {
    const host = hostNamed(name);
    const addr = normalize(addrText);
    const owner = Object.values(state.hosts).find((h) => addr !== null && owns(h, addr));
    if (!addr || !owner) throw new Error(`Cannot prime ${name} with ${addrText}`);
    setNeighbor(host, addr, owner.mac, 'REACHABLE');
    log(`${name} already has ${addr} at ${owner.mac} in its neighbor cache from earlier traffic.`);
  }

  /** @param {number} ms  How long an answered neighbour stays REACHABLE, kept within 10–300 s. */
  function setReachableMs(ms) {
    state.reachableMs = Math.min(MAX_REACHABLE_MS, Math.max(MIN_REACHABLE_MS, ms));
  }

  return {
    state,
    on,
    emit,
    send,
    fail,
    primeCache,
    setReachableMs,
    tick: sim.tick,
    runUntilIdle: sim.runUntilIdle,
    isIdle: sim.isIdle,
    nextEventAt: sim.nextEventAt,
  };
}

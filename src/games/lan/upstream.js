/**
 * R1's link toward the internet, shared by the LAN games (spec section 13, "Stage 1").
 * DOM-free. R1 forwards a LAN packet to the next hop; at the next hop a request is
 * answered, and the answer comes back from "the internet" to R1.
 *
 * Packets carry `ip: { src, dst, ttl }`. For IPv6 the `ttl` field holds the hop limit,
 * and `hopName` says which one the log should name.
 */

/**
 * @typedef {{ name: string }} Router
 * @typedef {{ id: number, dst: string, src: string, type: number, ip: { src: string, dst: string, ttl: number },
 *   app?: any, reply?: boolean, flow: number, parent?: number }} IpFrame
 */

/**
 * @param {import('./sim.js').Sim} sim
 * @param {{ link: { ip: string, mac: string, nextHop: { name: string, mac: string } }, etherType: number,
 *   hopName: string, ipTtl: number, internetHops: number, hopMs: number,
 *   labelOf: (packet: { app?: any, reply?: boolean }) => string, onLan: (router: any, frame: IpFrame) => void }} options
 */
export function createUpstream(sim, { link, etherType, hopName, ipTtl, internetHops, hopMs, labelOf, onLan }) {
  const to = link.nextHop.name;

  /**
   * R1 forwards a packet from the LAN: a new frame for the upstream link, one hop lower.
   * @param {Router} router
   * @param {IpFrame} frame
   */
  function forward(router, frame) {
    const { ip, app = 'ping', reply = false } = frame;
    /** @type {IpFrame} */
    const out = {
      id: sim.frameId(),
      dst: link.nextHop.mac,
      src: link.mac,
      type: etherType,
      ip: { ...ip, ttl: ip.ttl - 1 },
      app,
      reply,
      flow: frame.flow,
      parent: frame.id,
    };
    sim.emit('frame:forward', { frame, out, node: router.name, to, time: sim.now() });
    sim.log(
      `${router.name} removes the Ethernet header, looks up a route to ${ip.dst}, lowers the ${hopName} from ${ip.ttl} to ` +
        `${ip.ttl - 1} and builds a new frame for its upstream link: from its own MAC ${link.mac} to the next ` +
        `hop's ${link.nextHop.mac}. The MAC addresses change at every hop; the IP addresses stay ${ip.src} → ${ip.dst}.`,
    );
    routeOut(router, out);
  }

  /**
   * R1 sends a packet of its own to a far address.
   * @param {Router} router
   * @param {string} dst
   * @param {any} app
   * @param {number} flow
   */
  function originate(router, dst, app, flow) {
    sim.log(`${router.name} routes ${labelOf({ app })} for ${dst} straight out its upstream link to the next hop.`);
    routeOut(router, {
      id: sim.frameId(),
      dst: link.nextHop.mac,
      src: link.mac,
      type: etherType,
      ip: { src: link.ip, dst, ttl: ipTtl },
      app,
      flow,
    });
  }

  /**
   * Send a frame out the upstream link. At the next hop a request is answered.
   * @param {Router} router
   * @param {IpFrame} frame
   */
  function routeOut(router, frame) {
    sim.emit('frame:emit', { frame, from: router.name, to, at: sim.now(), arrivesAt: sim.now() + hopMs });
    sim.schedule(hopMs, () => {
      sim.emit('frame:arrive', { frame, node: to, time: sim.now() });
      const { ip } = frame;
      if (frame.reply) return;
      /** @type {IpFrame} */
      const back = {
        id: sim.frameId(),
        dst: link.mac,
        src: link.nextHop.mac,
        type: etherType,
        ip: { src: ip.dst, dst: ip.src, ttl: ipTtl - internetHops },
        app: frame.app,
        reply: true,
        flow: frame.flow,
      };
      sim.log(
        `${labelOf(back)} from ${ip.dst} comes back across the internet to the next hop, which sends it to ${router.name}.`,
      );
      sim.emit('frame:emit', { frame: back, from: to, to: router.name, at: sim.now(), arrivesAt: sim.now() + hopMs });
      sim.schedule(hopMs, () => receive(router, back));
    });
  }

  /**
   * R1 receives a packet on its upstream link: its own answer, or one for the LAN.
   * @param {Router} router
   * @param {IpFrame} frame
   */
  function receive(router, frame) {
    sim.emit('frame:arrive', { frame, node: router.name, time: sim.now() });
    if (frame.ip.dst === link.ip) {
      sim.log(`${router.name} receives ${labelOf(frame)} from ${frame.ip.src}.`);
      return;
    }
    onLan(router, frame);
  }

  return { forward, originate };
}

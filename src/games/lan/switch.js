/**
 * SW1, shared by the LAN games (spec section 13, "Stage 1"). DOM-free. It learns the
 * source MAC on the ingress port, floods group frames (broadcast or multicast) and unknown
 * unicasts out every other port, and forwards known unicasts out one port. Like an
 * unmanaged switch, or a Catalyst with MLD snooping off (its default), it tracks no groups.
 */
import { BROADCAST_MAC, isGroupMac } from './ethernet.js';

/**
 * A device on one of the switch's ports.
 * @typedef {{ name: string, mac: string, port: string, down: boolean }} Device
 */

/**
 * @param {import('./sim.js').Sim} sim
 * @param {{ name: string, table: Map<string, { port: string, expiresAt: number }>, devices: () => Device[],
 *   ttlMs: () => number, hopMs: number, deliver: (device: any, frame: any) => void }} options
 *   `table` is the game's MAC table (the switch fills it); `deliver` is the host's receive.
 */
export function createSwitch(sim, { name, table, devices, ttlMs, hopMs, deliver }) {
  /**
   * A frame arrives on `ingress`: learn, then flood or forward.
   * @param {{ id: number, src: string, dst: string }} frame
   * @param {string} ingress
   * @returns {Device[]} The devices a copy went to.
   */
  function receive(frame, ingress) {
    const now = sim.now();
    sim.emit('frame:arrive', { frame, node: name, time: now });
    const expiresAt = now + ttlMs();
    const known = table.get(frame.src);
    table.set(frame.src, { port: ingress, expiresAt });
    sim.emit('mactable:update', { mac: frame.src, port: ingress, expiresAt });
    if (!known) sim.log(`${name} learns that ${frame.src} is on ${ingress}.`);

    const entry = table.get(frame.dst);
    /** @type {Device[]} */
    let outs;
    // Either way the frame leaves exactly as it arrived: a switch never rewrites it.
    let how = 'forward';
    // A failed host's port is down, so nothing goes out of it.
    const others = devices().filter((device) => device.port !== ingress && !device.down);
    if (isGroupMac(frame.dst)) {
      how = 'flood';
      outs = others;
      sim.log(
        frame.dst === BROADCAST_MAC
          ? `${name} floods the broadcast out every other port.`
          : `${name} floods the multicast out every other port: it doesn't track who joined which group.`,
      );
    } else if (!entry) {
      how = 'flood';
      outs = others;
      sim.log(`${name} has no entry for ${frame.dst}, so it floods the frame out every other port.`);
    } else {
      const out = devices().find((device) => device.port === entry.port);
      outs = out && entry.port !== ingress ? [out] : [];
      if (out) sim.log(`${name} knows ${frame.dst} is on ${entry.port} and forwards the frame only there.`);
    }

    for (const device of outs) {
      sim.emit('frame:emit', { frame, from: name, to: device.name, how, at: now, arrivesAt: now + hopMs });
      sim.schedule(hopMs, () => deliver(device, frame));
    }
    return outs;
  }

  /** Remove entries whose time is up. */
  function expire() {
    for (const [mac, entry] of table) {
      if (entry.expiresAt <= sim.now()) {
        table.delete(mac);
        sim.emit('mactable:expire', { mac, port: entry.port });
      }
    }
  }

  /** @param {string} port  A port went down: forget every MAC learnt there. */
  function forgetPort(port) {
    for (const [mac, entry] of table) {
      if (entry.port !== port) continue;
      table.delete(mac);
      sim.emit('mactable:expire', { mac, port: entry.port });
    }
  }

  return { receive, expire, forgetPort };
}

/**
 * A network card's receive filter, shared by the LAN games. DOM-free.
 * Real cards do this in hardware, so the host's software never sees a dropped frame.
 */
import { BROADCAST_MAC, isGroupMac } from './ethernet.js';

/**
 * Why the card drops a frame, or null when it passes it up to the host.
 * @param {{ mac: string, groups?: Set<string> }} host  `groups`: the multicast MACs it has joined.
 * @param {string} dst  The frame's Ethernet destination.
 * @returns {null | 'not for me' | 'not my group (network card)'}
 */
export function nicDrop(host, dst) {
  if (dst === host.mac || dst === BROADCAST_MAC || host.groups?.has(dst)) return null;
  return isGroupMac(dst) ? 'not my group (network card)' : 'not for me';
}

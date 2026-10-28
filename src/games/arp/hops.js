/**
 * ARP's hop table (spec section 6, "View"): the shared rows from src/games/lan/hops.js,
 * with ARP's notes for what a host meant by each frame. DOM-free.
 */
import { buildHopRows } from '../lan/hops.js';
import { appLabel, frameKind } from './frames.js';

/** @typedef {import('../lan/hops.js').HopRow} HopRow */

/**
 * What a host meant by a frame it sent.
 * @param {any} frame
 * @param {string} from
 * @param {HopRow} row
 */
function origin(frame, from, row) {
  if (row.kind === 'request') {
    return frame.arp.spa === frame.arp.tpa
      ? `${from} announces its own address to everyone (gratuitous ARP).`
      : `${from} broadcasts: who has ${frame.arp.tpa}?`;
  }
  if (row.kind === 'reply') return `${from} replies only to ${row.ethDst}: ${frame.arp.spa} is at ${frame.arp.sha}.`;
  return `${from} wraps the ${appLabel(frame).long} in a frame for ${row.ethDst}.`;
}

/**
 * @param {{ frame: any, from: string, to: string, how?: 'flood' | 'forward' }[]} hops  One flow's frame:emit payloads, in order.
 * @param {(mac: string) => string} nameOf  Turns a MAC into a device name for the table.
 * @returns {HopRow[]}
 */
export function hopRows(hops, nameOf) {
  return buildHopRows(hops, { nameOf, kindOf: frameKind, origin });
}

/**
 * Neighbor Discovery's hop table (spec section 13): the shared rows from src/games/lan/hops.js,
 * with ND's notes for what a device meant by each frame. DOM-free.
 */
import { buildHopRows } from '../lan/hops.js';
import { appLabel, frameKind, ND_NS } from './frames.js';

/** @typedef {import('../lan/hops.js').HopRow} HopRow */

/**
 * What a device meant by a frame it sent.
 * @param {any} frame
 * @param {string} from
 * @param {HopRow} row
 */
function origin(frame, from, row) {
  const { nd, ip } = frame;
  if (!nd) return `${from} wraps the ${appLabel(frame).long} in a frame for ${row.ethDst}.`;
  if (nd.type === ND_NS) {
    if (ip.src === '::')
      return `${from} checks that nobody else uses ${nd.target} (DAD), from the unspecified address ::.`;
    if (ip.dst === nd.target) return `${from} checks that ${nd.target} is still at ${row.ethDst}.`;
    return `${from} asks ${nd.target}’s solicited-node group, ${ip.dst}: who has ${nd.target}?`;
  }
  if (!nd.solicited) return `${from} tells all nodes: ${nd.target} is at ${nd.lla}.`;
  return `${from} answers only ${row.ethDst}: ${nd.target} is at ${nd.lla}.`;
}

/**
 * @param {{ frame: any, from: string, to: string, how?: 'flood' | 'forward' }[]} hops  One flow's frame:emit payloads, in order.
 * @param {(mac: string) => string} nameOf
 * @returns {HopRow[]}
 */
export function hopRows(hops, nameOf) {
  return buildHopRows(hops, { nameOf, kindOf: frameKind, origin, hopName: 'Hop limit' });
}

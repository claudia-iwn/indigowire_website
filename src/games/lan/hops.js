/**
 * The hop table (spec sections 6 and 13): what each device did to a frame on its way.
 * DOM-free. The renderer collects an exchange's frame:emit events and passes them here;
 * each game says what kind each frame is and what a host meant by sending it.
 */
import { BROADCAST_MAC } from './ethernet.js';

/**
 * @typedef {object} HopRow
 * @property {string} from
 * @property {string[]} to   One name, or every port a flood went out of.
 * @property {string} kind    The game's frame kind, e.g. 'request', 'reply' or 'data'.
 * @property {string} ethDst  A device name (or "broadcast"), not a raw MAC.
 * @property {string} ethSrc
 * @property {{ src: string, dst: string, ttl: number } | null} ip  IP frames only.
 * @property {('ethDst' | 'ethSrc' | 'ttl')[]} changed  What differs from the frame this one was built from.
 * @property {string} note    One line: what the device did.
 * @property {any} frame
 */

/**
 * @param {{ frame: any, from: string, to: string, how?: 'flood' | 'forward' }[]} hops  One flow's frame:emit payloads, in order.
 * @param {{ nameOf: (mac: string) => string, kindOf: (frame: any) => string,
 *   origin: (frame: any, from: string, row: HopRow) => string, hopName?: string }} game
 *   `origin` writes the note for a frame a host sent; `hopName` is 'TTL' or 'Hop limit'.
 * @returns {HopRow[]}
 */
export function buildHopRows(hops, { nameOf, kindOf, origin, hopName = 'TTL' }) {
  /** @type {HopRow[]} */
  const rows = [];
  /** Last row for each frame id, so a rebuilt frame can be compared with its parent. */
  /** @type {Map<number, HopRow>} */
  const lastRow = new Map(); // like a Python dict

  for (const { frame, from, to, how } of hops) {
    // Copies of one flood leave the switch together: one row lists every port.
    const prev = rows.at(-1);
    if (how === 'flood' && prev && prev.frame === frame && prev.from === from) {
      prev.to.push(to);
      continue;
    }
    /** @type {HopRow} */
    const row = {
      from,
      to: [to],
      kind: kindOf(frame),
      ethDst: frame.dst === BROADCAST_MAC ? 'broadcast' : nameOf(frame.dst),
      ethSrc: nameOf(frame.src),
      ip: frame.ip ? { ...frame.ip } : null,
      changed: [],
      note: '',
      frame,
    };

    const parent = frame.parent !== undefined ? lastRow.get(frame.parent) : undefined;
    if (parent) {
      if (parent.ethDst !== row.ethDst) row.changed.push('ethDst');
      if (parent.ethSrc !== row.ethSrc) row.changed.push('ethSrc');
      if (parent.ip && row.ip && parent.ip.ttl !== row.ip.ttl) row.changed.push('ttl');
      row.note =
        `${from} removed the old Ethernet header and built a new frame for the next link: ` +
        `new source and destination MACs, ${hopName} ${parent.ip?.ttl} → ${row.ip?.ttl}. The IP addresses are unchanged.`;
    } else if (from === 'SW1') {
      row.note =
        how === 'flood'
          ? 'SW1 floods a copy out every other port, unchanged.'
          : 'SW1 looks up the destination MAC and forwards it unchanged out one port.';
    } else {
      row.note = origin(frame, from, row);
    }
    rows.push(row);
    lastRow.set(frame.id, row);
  }
  return rows;
}

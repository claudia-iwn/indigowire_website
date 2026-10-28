/**
 * The Neighbor Discovery simulator's view (spec section 13): the shared LAN view
 * (src/games/lan/renderer.js) with ND's layout, labels, neighbor-cache columns and bubbles.
 */
import { mountLanRenderer, NEXT_HOP } from '../lan/renderer.js';
import { HOP_MS, MAC_AGE_MS, TOPOLOGY } from './engine.js';
import { breakdown, describeFrame, encodeFrame, frameFields, frameKind, frameLabel, frameNotes } from './frames.js';
import { hopRows } from './hops.js';

/**
 * Where everything sits: the ARP game's places, with taller boxes for two address lines.
 * @type {Record<'wide' | 'narrow', import('../lan/renderer.js').Layout>}
 */
export const LAYOUTS = {
  wide: {
    viewBox: '0 0 900 500',
    box: { w: 176, h: 104 },
    macSize: 12.5,
    addrSize: 12.5,
    card: 'above',
    places: {
      H1: { x: 110, y: 85 },
      H2: { x: 110, y: 250 },
      H3: { x: 110, y: 415 },
      SW1: { x: 420, y: 250 },
      R1: { x: 640, y: 250 },
      [NEXT_HOP]: { x: 830, y: 250 },
    },
  },
  narrow: {
    viewBox: '0 0 400 600',
    // Two hosts to a row, not ARP's three, so the boxes are wide enough for
    // "2001:db8:0:1::12 duplicate" at a readable size; H3 sits beside the switch.
    box: { w: 184, h: 100 },
    macSize: 10,
    addrSize: 10,
    card: 'right',
    places: {
      H1: { x: 100, y: 62 },
      H2: { x: 300, y: 62 },
      SW1: { x: 100, y: 245 },
      H3: { x: 300, y: 245 },
      R1: { x: 100, y: 410 },
      [NEXT_HOP]: { x: 100, y: 548 },
    },
  },
};

/**
 * The address lines in a node's box: its global address (or the one DAD is checking, or the
 * one DAD refused), then its link-local address.
 * @param {any} node
 */
function addressLines(node) {
  const global =
    node.global ??
    (node.tentative ? `${node.tentative} (DAD)` : node.duplicate ? `${node.duplicate} duplicate` : 'no global address');
  return [global, node.linkLocal];
}

/** @type {import('../lan/renderer.js').LanView} */
const ND_VIEW = {
  layouts: LAYOUTS,
  upstream: TOPOLOGY.upstream,
  hopMs: HOP_MS,
  hopName: 'Hop limit',
  lifetime: { cache: (engine) => /** @type {any} */ (engine).state.reachableMs, mac: () => MAC_AGE_MS },
  addressLines,
  frameKind,
  frameLabel,
  describe: describeFrame,
  cache: {
    columns: ['Address', 'MAC', 'State'],
    // Like Python's [(addr, e) for addr, e in host.neighbors.items()]; only REACHABLE counts down.
    rows: (host) =>
      [...host.neighbors].map(([addr, entry]) => ({
        key: addr,
        values: [addr, entry.mac, entry.state],
        ...(entry.state === 'REACHABLE' ? { expiresAt: entry.reachableUntil } : {}),
      })),
  },
  bubbles: {
    'nd:unreachable': ({ host }) => ({
      host,
      text: 'No answer to 3 Neighbor Solicitations, a second apart: the application gets "address unreachable".',
    }),
    'dad:duplicate': ({ host, ip, mac }) => ({
      host,
      text: `Duplicate address! ${mac} already uses ${ip}, so ${host} won’t use it.`,
    }),
  },
  hopRows,
  packet: {
    kindOf: frameKind,
    describe: describeFrame,
    breakdown,
    fields: frameFields,
    bytes: encodeFrame,
    bytesSummary: (frame, bytes) =>
      bytes.length > 14
        ? `Bytes: all ${bytes.length} on the wire (without the FCS)`
        : 'Bytes: the 14-byte Ethernet header',
    hopFrame: (row) => (row.frame.nd ? (row.frame.nd.type === 135 ? 'NS' : 'NA') : row.frame.app),
    notes: frameNotes,
  },
};

/**
 * Draw the Neighbor Discovery simulation and keep it in step with the engine.
 * @param {Parameters<typeof mountLanRenderer>[0]} parts
 * @param {ReturnType<typeof import('./engine.js').createEngine>} engine
 * @param {{ onInspect?: (frame: any) => void }} [options]
 */
export function mountRenderer(parts, engine, options) {
  return mountLanRenderer(parts, /** @type {any} */ (engine), ND_VIEW, options);
}

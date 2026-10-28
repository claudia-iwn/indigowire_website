/**
 * The ARP simulator's view (spec section 6, "View"): the shared LAN view
 * (src/games/lan/renderer.js) with ARP's layout, labels, cache columns and bubbles.
 */
import { mountLanRenderer, NEXT_HOP } from '../lan/renderer.js';
import { HOP_MS, TOPOLOGY } from './engine.js';
import {
  appLabel,
  arpFields,
  breakdown,
  dataFields,
  describeFrame,
  encodeArpFrame,
  encodeEthernetHeader,
  frameKind,
} from './frames.js';
import { hopRows } from './hops.js';

/**
 * Where everything sits, for wide screens and phones (portrait). Coordinates are in
 * the SVG's viewBox units, so the drawing scales with its box.
 */
/** @type {Record<'wide' | 'narrow', import('../lan/renderer.js').Layout>} */
export const LAYOUTS = {
  wide: {
    viewBox: '0 0 900 500',
    box: { w: 176, h: 80 },
    macSize: 12.5,
    // Where R1's before/after card goes, so it doesn't cover the switch.
    card: 'above',
    places: {
      H1: { x: 110, y: 85 },
      H2: { x: 110, y: 250 },
      H3: { x: 110, y: 415 },
      SW1: { x: 420, y: 250 },
      R1: { x: 640, y: 250 },
      M: { x: 420, y: 430 },
      [NEXT_HOP]: { x: 830, y: 250 },
    },
  },
  narrow: {
    viewBox: '0 0 400 600',
    box: { w: 122, h: 78 },
    // Smaller so a full MAC fits the narrower boxes.
    macSize: 10,
    card: 'right',
    places: {
      H1: { x: 66, y: 60 },
      H2: { x: 200, y: 60 },
      H3: { x: 334, y: 60 },
      SW1: { x: 200, y: 245 },
      R1: { x: 110, y: 410 },
      M: { x: 300, y: 410 },
      [NEXT_HOP]: { x: 110, y: 548 },
    },
  },
};

/** Short label drawn on a frame. */
/** @param {any} frame */
function frameLabel(frame) {
  if (!frame.arp) return appLabel(frame).short;
  if (frame.arp.spa === frame.arp.tpa) return 'GARP';
  return frame.arp.oper === 1 ? 'ARP?' : 'ARP!';
}

/** @type {import('../lan/renderer.js').LanView} */
const ARP_VIEW = {
  layouts: LAYOUTS,
  upstream: TOPOLOGY.upstream,
  hopMs: HOP_MS,
  hopName: 'TTL',
  addressLines: (node) => [node.ip],
  frameKind,
  frameLabel,
  describe: describeFrame,
  cache: {
    columns: ['IP', 'MAC', 'Expires'],
    // Like Python's [(ip, e) for ip, e in host.arp_cache.items()]
    rows: (host) =>
      [...host.arpCache].map(([ip, entry]) => ({ key: ip, values: [ip, entry.mac, ''], expiresAt: entry.expiresAt })),
  },
  bubbles: {
    'arp:timeout': ({ host }) => ({
      host,
      text: 'No reply. A real host typically retries about 3 times, a second apart, then reports the destination unreachable.',
    }),
    'ip:conflict': ({ host, ip, mac }) => ({ host, text: `Duplicate IP address! ${mac} also claims ${ip}.` }),
  },
  hopRows,
  packet: {
    kindOf: frameKind,
    describe: describeFrame,
    breakdown,
    fields: (frame) => (frame.arp ? arpFields(frame) : dataFields(frame)),
    bytes: (frame) => (frame.arp ? encodeArpFrame(frame) : encodeEthernetHeader(frame)),
    bytesSummary: (frame, bytes) =>
      frame.arp ? `Bytes: all ${bytes.length} on the wire (without the FCS)` : 'Bytes: the 14-byte Ethernet header',
    hopFrame: (row) => (row.kind === 'data' ? row.frame.app : `ARP ${row.kind}`),
    hopName: 'TTL',
  },
};

/**
 * Draw the ARP simulation and keep it in step with the engine.
 * @param {Parameters<typeof mountLanRenderer>[0]} parts
 * @param {ReturnType<typeof import('./engine.js').createEngine>} engine
 * @param {{ onInspect?: (frame: any) => void }} [options]
 */
export function mountRenderer(parts, engine, options) {
  return mountLanRenderer(parts, engine, ARP_VIEW, options);
}

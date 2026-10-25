/**
 * Frame building and hex encoding for the inspector (spec section 6).
 * STUB (M4): constants are real; encoding is not implemented yet.
 */

export const BROADCAST_MAC = 'ff:ff:ff:ff:ff:ff';
export const ZERO_MAC = '00:00:00:00:00:00';
export const ETHERTYPE_ARP = 0x0806;
export const ETHERTYPE_IPV4 = 0x0800;
export const ARP_REQUEST = 1;
export const ARP_REPLY = 2;
/** Ethernet minimum frame size without FCS: 14-byte header + 28-byte ARP + padding. */
export const MIN_FRAME_BYTES = 60;

/**
 * @typedef {object} ArpFrame
 * @property {string} dst  Ethernet destination MAC.
 * @property {string} src  Ethernet source MAC.
 * @property {1 | 2} oper
 * @property {string} sha  Sender hardware address.
 * @property {string} spa  Sender protocol address.
 * @property {string} tha  Target hardware address.
 * @property {string} tpa  Target protocol address.
 */

/**
 * Encode a frame to bytes, padded to 60. TODO(M4).
 * @param {ArpFrame} frame
 * @returns {Uint8Array}
 */
export function encodeArpFrame(frame) {
  throw new Error(`encodeArpFrame is not implemented yet (M4): ${frame.oper}`);
}

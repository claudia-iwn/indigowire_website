/**
 * Ethernet addresses shared by the LAN games. DOM-free.
 */

export const BROADCAST_MAC = 'ff:ff:ff:ff:ff:ff';

/**
 * True for a group address (broadcast or multicast): the lowest bit of the first byte is
 * 1, as in ff:ff:ff:ff:ff:ff or IPv6's 33:33:…
 * @param {string} mac Colon-separated hex.
 */
export const isGroupMac = (mac) => (parseInt(mac.slice(0, 2), 16) & 1) === 1;

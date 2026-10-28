/**
 * The Learn mode's guided lesson (spec section 13, "Modes"): H1 pings H2 with empty caches,
 * then pings again. DOM-free. Each step has a caption and the engine event it ends on; the
 * shared playback (src/games/lan/lesson.js) plays to it. No two steps end in the same tick
 * (lesson.test.js checks), or the second one's event would fire before it started listening.
 */
import { playLesson, tickToward, watchStep } from '../lan/lesson.js';

/** @typedef {ReturnType<typeof import('./engine.js').createEngine>} Engine */
/** @typedef {import('../lan/lesson.js').LessonStep} LessonStep */

const H2_ADDR = '2001:db8:0:1::12';

/** @param {any} frame */
const isNs = (frame) => frame.nd?.type === 135;
/** @param {any} frame */
const isNa = (frame) => frame.nd?.type === 136;

/** @type {LessonStep[]} */
export const LESSON = [
  {
    title: 'H1 wants to ping H2',
    note: { node: 'H1', text: 'Wants to ping ::12, but has no MAC for it' },
    caption:
      'H1 (you) wants to ping H2 at 2001:db8:0:1::12. Every neighbor cache is empty and SW1 has learnt no MAC addresses yet. Press Next to send the ping.',
  },
  {
    title: 'Why Neighbor Discovery?',
    note: { node: 'H1', text: 'Who has ::12? Asks ff02::1:ff00:12 only' },
    caption:
      'The ping knows only the IPv6 address, and Ethernet delivers frames by MAC address. IPv6 has no ARP and no broadcast. H1 holds the ping back and sends an ICMPv6 Neighbor Solicitation, "who has 2001:db8:0:1::12?", with its own MAC inside. It goes to H2’s solicited-node group: ff02::1:ff plus the address’s last 24 bits, ff02::1:ff00:12, whose MAC is 33:33 plus its last 32 bits, 33:33:ff:00:00:12. H2’s link-local address, fe80::12, ends the same way, so one group covers both.',
    start: (engine) => engine.send('H1', H2_ADDR, 'ping'),
    until: { event: 'frame:emit', match: (hop) => hop.from === 'H1' && isNs(hop.frame) },
  },
  {
    title: 'SW1 learns and floods',
    note: { node: 'SW1', text: 'H1 is on Gi0/1. Multicast: flood it' },
    caption:
      'SW1 notes that H1’s MAC is on port Gi0/1. The destination is a multicast MAC, and this switch doesn’t track who joined which group (MLD snooping is off, as it is by default on Cisco Catalyst switches), so it floods a copy out every other port in the same VLAN, as it would an ARP broadcast. This LAN has one VLAN; chapter 5, Broadcasts and VLANs, explains more.',
    until: { event: 'frame:emit', match: (hop) => hop.from === 'SW1' && hop.how === 'flood' && isNs(hop.frame) },
  },
  {
    title: 'Only H2’s network card listens',
    note: { node: 'H3', text: 'Not my group: the network card drops it' },
    caption:
      'H3 and R1 haven’t joined ff02::1:ff00:12, so their network cards drop the frame in hardware and their software never sees it. With ARP, every host’s software had to read the broadcast and decide it wasn’t for them. H2’s card has joined the group, so it passes the solicitation up.',
    until: { event: 'frame:drop', match: (drop) => drop.node === 'R1' },
  },
  {
    title: 'H2 notes H1 as STALE and answers',
    note: { node: 'H2', text: 'Noted H1 as STALE, answered with an NA' },
    caption:
      'H2 owns 2001:db8:0:1::12. It notes H1’s address and MAC from the solicitation, marked STALE: the message proves H1 exists, not that H2’s frames can reach it. It answers with a Neighbor Advertisement sent straight to H1’s MAC, with the Solicited and Override flags set. SW1 learns H2 on Gi0/2 and, knowing H1’s port, forwards it out that one port.',
    until: { event: 'frame:emit', match: (hop) => hop.from === 'SW1' && isNa(hop.frame) },
  },
  {
    title: 'H1 marks H2 REACHABLE',
    note: { node: 'H1', text: '::12 is H2’s MAC: REACHABLE. Ping goes' },
    caption:
      'The advertisement answers H1’s own question, which proves the path works both ways, so H1 marks 2001:db8:0:1::12 REACHABLE (for about 30 seconds) and sends the ping it was holding, in a frame addressed to H2’s MAC.',
    until: { event: 'cache:update', match: (e) => e.host === 'H1' && e.state === 'REACHABLE' },
  },
  {
    title: 'H2 answers, then checks on H1',
    note: { node: 'H2', text: 'H1 is STALE: reply now, then check H1' },
    caption:
      'The ping reaches H2. H2’s entry for H1 is STALE, so it sends the echo reply at once and then checks on H1 with a Neighbor Solicitation sent straight to H1’s MAC, not to a group. Real hosts wait 5 seconds before checking (the DELAY state), in case other traffic proves H1 is there; the game checks straight away.',
    until: { event: 'frame:arrive', match: (e) => e.node === 'H2' && !e.frame.nd && !e.frame.reply },
  },
  {
    title: 'The echo reply reaches H1',
    note: { node: 'H1', text: 'Echo reply in. Answers H2’s check too' },
    caption:
      'The echo reply reaches H1: the round trip is done. H1 also gets H2’s check, and answers it with a Neighbor Advertisement of its own.',
    until: { event: 'frame:arrive', match: (e) => e.node === 'H1' && e.frame.reply },
  },
  {
    title: 'H2’s check is answered',
    note: { node: 'H2', text: 'H1 answered: REACHABLE' },
    caption:
      'H1’s answer reaches H2, so H2 marks H1 REACHABLE too. Both neighbor caches now hold each other, with a countdown until each entry turns STALE again.',
    until: { event: 'cache:update', match: (e) => e.host === 'H2' && e.state === 'REACHABLE' },
  },
  {
    title: 'Ping again: no Neighbor Discovery',
    note: { node: 'H1', text: 'REACHABLE: straight to H2’s MAC' },
    caption:
      'H1 pings 2001:db8:0:1::12 again. Both entries are REACHABLE, so the ping and its reply go straight out: no solicitations, no checks. Try Sandbox mode next, or the DAD and unsolicited NA mode.',
    start: (engine) => engine.send('H1', H2_ADDR, 'ping'),
    until: { event: 'frame:arrive', match: (e) => e.node === 'H1' && e.frame.reply && e.frame.flow === 2 },
  },
];

export { watchStep, tickToward };

/**
 * Run the lesson instantly from the end of step `from` to the end of step `to`.
 * @param {Engine} engine
 * @param {number} to
 * @param {number} [from]  The step the engine is already at (0 for a fresh engine).
 */
export function playTo(engine, to, from = 0) {
  playLesson(engine, LESSON, to, from);
}

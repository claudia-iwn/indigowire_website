/**
 * The Learn mode's guided lesson (spec section 6, "Modes"): H1 pings H2 with empty
 * caches, then pings again. DOM-free, like the engine.
 *
 * Each step has a caption and the engine event it ends on. Live, the controller plays
 * the clock until that event fires (watchStep) and pauses. Back rebuilds the lesson in
 * a fresh engine and jumps straight to the step before (playTo). The engine always does
 * the same thing for the same input, so the rebuilt state is exact.
 */

/** @typedef {ReturnType<typeof import('./engine.js').createEngine>} Engine */

/**
 * @typedef {object} LessonStep
 * @property {string} title
 * @property {string} caption
 * @property {{ node: string, text: string }} note  Drawn beside `node` on the diagram when the step ends.
 * @property {(engine: Engine) => void} [start]  Run when the step begins, e.g. a send.
 * @property {{ event: 'frame:emit' | 'frame:arrive', match: (payload: any) => boolean }} [until]
 */

const H2_IP = '192.0.2.12';

/** @param {any} frame */
const isRequest = (frame) => frame.arp?.oper === 1;
/** @param {any} frame */
const isArpReply = (frame) => frame.arp?.oper === 2;

/** @type {LessonStep[]} */
export const LESSON = [
  {
    title: 'H1 wants to ping H2',
    note: { node: 'H1', text: 'Wants to ping 192.0.2.12, but has no MAC for it' },
    caption:
      'H1 (you) wants to ping H2 at 192.0.2.12. Every ARP cache is empty and SW1 has learnt no MAC addresses yet. Press Next to send the ping.',
  },
  {
    title: 'Why ARP?',
    note: { node: 'H1', text: 'Who has 192.0.2.12? (broadcast)' },
    caption:
      'The ping knows only the IP address, 192.0.2.12. Ethernet delivers frames by MAC address, and H1 has no MAC for H2. So H1 holds the ping back and broadcasts an ARP request to ff:ff:ff:ff:ff:ff: "Who has 192.0.2.12? Tell 192.0.2.11."',
    start: (engine) => engine.send('H1', H2_IP, 'ping'),
    until: { event: 'frame:emit', match: (hop) => hop.from === 'H1' && isRequest(hop.frame) },
  },
  {
    title: 'SW1 learns and floods',
    note: { node: 'SW1', text: 'H1 is on Gi0/1. Broadcast: flood it' },
    caption:
      'SW1 notes that H1’s MAC is on port Gi0/1 (see its MAC address table). The destination is the broadcast address, so it floods a copy out every other port in the same VLAN, unchanged. This LAN has one VLAN; chapter 5, Broadcasts and VLANs, explains more.',
    until: { event: 'frame:emit', match: (hop) => hop.from === 'SW1' && hop.how === 'flood' },
  },
  {
    title: 'Only H2 answers',
    note: { node: 'H2', text: 'That’s me! Cache H1, reply to H1' },
    caption:
      'H3 and R1 are not 192.0.2.12, so they drop the request. H2 is: it caches H1’s address (it will need it to answer) and sends an ARP reply straight to H1’s MAC: "192.0.2.12 is at 00:00:5e:00:53:12."',
    until: { event: 'frame:emit', match: (hop) => hop.from === 'H2' && isArpReply(hop.frame) },
  },
  {
    title: 'A unicast reply',
    note: { node: 'SW1', text: 'H2 is on Gi0/2. H1 is known: one port' },
    caption:
      'SW1 learns H2 on Gi0/2. It already knows H1 is on Gi0/1, so this time it forwards the reply out that one port only. H3 and R1 never see it.',
    until: { event: 'frame:emit', match: (hop) => hop.from === 'SW1' && isArpReply(hop.frame) },
  },
  {
    title: 'H1 sends the ping',
    note: { node: 'H1', text: '192.0.2.12 is H2’s MAC. Send the ping' },
    caption: 'H1 caches 192.0.2.12 at H2’s MAC and sends the ping it was holding, in a frame addressed to H2’s MAC.',
    until: { event: 'frame:emit', match: (hop) => hop.from === 'H1' && !hop.frame.arp },
  },
  {
    title: 'H2 answers the ping',
    note: { node: 'H2', text: 'Ping in, echo reply out. No ARP needed' },
    caption:
      'H2 receives the ping and sends an ICMP echo reply. It learnt H1’s MAC from the ARP request, so it needs no ARP of its own.',
    until: { event: 'frame:emit', match: (hop) => hop.from === 'H2' && hop.frame.reply },
  },
  {
    title: 'The round trip is done',
    note: { node: 'H1', text: 'Echo reply in. Round trip done' },
    caption:
      'The echo reply reaches H1. One ping cost a broadcast, a reply and the ping itself. Both hosts now have each other in their ARP caches, with a countdown until the entries expire.',
    until: { event: 'frame:arrive', match: (e) => e.node === 'H1' && e.frame.reply },
  },
  {
    title: 'Ping again: no ARP',
    note: { node: 'H1', text: 'Already cached: straight to H2’s MAC' },
    caption:
      'H1 pings 192.0.2.12 again. The address is in its cache, so the ping goes straight out to H2’s MAC: no broadcast, no waiting. That is what the cache is for. Try Sandbox mode next.',
    start: (engine) => engine.send('H1', H2_IP, 'ping'),
    until: { event: 'frame:arrive', match: (e) => e.node === 'H1' && e.frame.reply && e.frame.flow === 2 },
  },
];

/**
 * Call `onDone` once when `step`'s ending event fires.
 * @param {Engine} engine
 * @param {LessonStep} step
 * @param {() => void} onDone
 * @returns {() => void} Unsubscribe.
 */
export function watchStep(engine, step, onDone) {
  if (!step.until) return () => {};
  const { event, match } = step.until;
  let fired = false;
  return engine.on(event, (payload) => {
    if (!fired && match(payload)) {
      fired = true;
      onDone();
    }
  });
}

/**
 * Advance the clock by up to `ms`, but stop exactly on the next queued event, so a step
 * can end on the moment its event happens.
 * @param {Engine} engine
 * @param {number} ms
 */
export function tickToward(engine, ms) {
  const next = engine.nextEventAt();
  const now = engine.state.clock;
  engine.tick(next !== null && next <= now + ms ? next - now : ms);
}

/**
 * Run the lesson instantly from the end of step `from` to the end of step `to`.
 * @param {Engine} engine
 * @param {number} to
 * @param {number} [from]  The step the engine is already at (0 for a fresh engine).
 */
export function playTo(engine, to, from = 0) {
  for (let n = from + 1; n <= to; n++) {
    const step = LESSON[n];
    let done = false;
    const off = watchStep(engine, step, () => (done = true));
    step.start?.(engine);
    // Jump from event to event; stop if the engine runs dry (it shouldn't).
    while (!done && !engine.isIdle()) tickToward(engine, Infinity);
    off();
  }
}

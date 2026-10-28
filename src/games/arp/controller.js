/**
 * Starts the ARP simulator page (spec section 6, "Modes"): the shared LAN controller
 * (src/games/lan/controller.js) with ARP's engine, view, lesson, address check and the
 * Gratuitous ARP mode's controls.
 */
import { startLanSimulator } from '../lan/controller.js';
import { createEngine, DEFAULT_TTL_MS } from './engine.js';
import { LESSON, playTo } from './lesson.js';
import { mountRenderer } from './renderer.js';

/** Dotted-quad IPv4, each part 0–255. */
const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;

/**
 * Gratuitous ARP mode: Announce, and the two scenarios.
 * @param {import('../lan/controller.js').LanController} control
 */
function setupGarp({ find, engine, view, remount, setPlaying }) {
  const garpHost = /** @type {HTMLSelectElement} */ (find('#garp-host'));
  const garpStatus = find('.garp-status');

  find('#garp-announce').addEventListener('click', () => {
    engine().announce(garpHost.value);
    setPlaying(true);
  });

  /**
   * Start a scenario from warm caches: H1 and R1 have both talked to H2 recently.
   * @param {(engine: ReturnType<typeof createEngine>) => void} run
   * @param {string} status  What to watch, read out by the live region.
   */
  function scenario(run, status) {
    remount();
    engine().primeCache('H1', '192.0.2.12');
    engine().primeCache('R1', '192.0.2.12');
    run(engine());
    view().redraw();
    garpStatus.textContent = status;
    setPlaying(true);
  }

  find('#garp-failover').addEventListener('click', () =>
    scenario((sim) => {
      sim.fail('H2');
      sim.claimIp('H3', '192.0.2.12', 'H3, H2’s standby, stops hearing H2’s heartbeats and takes over 192.0.2.12.');
    }, 'Watch H1’s and R1’s caches: 192.0.2.12 moves to H3’s MAC, with no alarm, because H2 is down. Then send a ping from H1 to 192.0.2.12: H3 answers.'),
  );
  find('#garp-meanwhile').addEventListener('click', () =>
    scenario(
      (sim) => sim.claimIp('H3', '192.0.2.12'),
      'H2 is still up, so it sees its own address claimed and reports a duplicate IP. H1’s and R1’s caches flip to H3’s MAC: their traffic for H2 now goes to the wrong host.',
    ),
  );

  return {
    onMount: () => {
      garpStatus.textContent = '';
    },
  };
}

/**
 * Start the simulator inside `root` (the page's [data-arp] element).
 * @param {HTMLElement} root
 */
export function startSimulator(root) {
  startLanSimulator(root, {
    name: 'ARP simulator',
    prefix: 'arp',
    modes: ['learn', 'sandbox', 'garp'],
    defaultTtlMs: DEFAULT_TTL_MS,
    createEngine,
    mountView: mountRenderer,
    lesson: LESSON,
    playTo,
    checkAddress: (ip) => (IPV4.test(ip) ? null : 'Enter an IPv4 address, such as 192.0.2.12.'),
    setTtl: (engine, ms) => engine.setTtl(ms),
    setup: setupGarp,
  });
}

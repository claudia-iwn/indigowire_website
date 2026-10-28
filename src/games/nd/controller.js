/**
 * Starts the Neighbor Discovery simulator page (spec section 13, "Modes"): the shared LAN
 * controller (src/games/lan/controller.js) with ND's engine, view, lesson, address check,
 * the Sandbox fail control and the DAD and unsolicited NA scenarios.
 */
import { startLanSimulator } from '../lan/controller.js';
import { createEngine, DEFAULT_REACHABLE_MS } from './engine.js';
import { isLoopback, isMulticast, normalize } from './ipv6.js';
import { LESSON, playTo } from './lesson.js';
import { mountRenderer } from './renderer.js';

const H2_ADDR = '2001:db8:0:1::12';

/**
 * @param {string} text
 * @returns {string | null}  The error to show, or null when the address can be sent to.
 */
function checkAddress(text) {
  const addr = normalize(text);
  if (!addr) return 'Enter an IPv6 address, such as 2001:db8:0:1::12.';
  if (addr === '::' || isLoopback(addr) || isMulticast(addr))
    return 'Enter a unicast address: the game sends to one device, not :: or a group.';
  return null;
}

/**
 * Sandbox's fail control, and the DAD and unsolicited NA mode's three scenarios.
 * @param {import('../lan/controller.js').LanController} control
 */
function setupModes({ find, engine, view, remount, setPlaying }) {
  const failHost = /** @type {HTMLSelectElement} */ (find('#nd-fail-host'));
  const status = find('.dad-status');

  find('#nd-fail').addEventListener('click', () => {
    engine().fail(failHost.value);
    setPlaying(true);
  });

  /**
   * Start a scenario in a fresh simulation.
   * @param {(engine: ReturnType<typeof createEngine>) => void} run
   * @param {string} text  What to watch, read out by the live region.
   * @param {boolean} [warm]  Start with H1 and R1 already caching H2.
   */
  function scenario(run, text, warm = false) {
    remount();
    if (warm) {
      engine().primeCache('H1', H2_ADDR);
      engine().primeCache('R1', H2_ADDR);
    }
    run(engine());
    view().redraw();
    status.textContent = text;
    setPlaying(true);
  }

  find('#dad-join').addEventListener('click', () =>
    scenario(
      (sim) =>
        sim.claimIp(
          'H3',
          '2001:db8:0:1::13',
          'H3 joins the network with the address 2001:db8:0:1::13. Before using it, it checks that no other device has it: Duplicate Address Detection.',
        ),
      'Watch H3: its address is marked DAD while it waits a second for any answer. Nobody answers, so it starts using the address.',
    ),
  );
  find('#dad-failover').addEventListener('click', () =>
    scenario(
      (sim) => {
        sim.fail('H2');
        sim.takeOver('H3', H2_ADDR);
      },
      'Watch H1’s and R1’s caches: 2001:db8:0:1::12 moves to H3’s MAC, marked STALE. Then ping 2001:db8:0:1::12 from H1: the check confirms H3.',
      true,
    ),
  );
  find('#dad-duplicate').addEventListener('click', () =>
    scenario(
      (sim) =>
        sim.claimIp(
          'H3',
          H2_ADDR,
          'Meanwhile, on H3, someone sets a static address of 2001:db8:0:1::12, which is H2’s.',
        ),
      'H2 defends its address, so H3 refuses it. H1’s and R1’s caches never change: nobody’s traffic goes to the wrong host. H3 keeps only fe80::13 for now.',
      true,
    ),
  );

  return {
    onMount: () => {
      status.textContent = '';
    },
  };
}

/**
 * Start the simulator inside `root` (the page's [data-nd] element).
 * @param {HTMLElement} root
 */
export function startSimulator(root) {
  startLanSimulator(root, {
    name: 'Neighbor Discovery simulator',
    prefix: 'nd',
    modes: ['learn', 'sandbox', 'dad'],
    defaultTtlMs: DEFAULT_REACHABLE_MS,
    createEngine: ({ ttlMs }) => /** @type {any} */ (createEngine({ reachableMs: ttlMs })),
    mountView: mountRenderer,
    lesson: LESSON,
    playTo,
    checkAddress,
    setTtl: (engine, ms) => engine.setReachableMs(ms),
    setup: setupModes,
  });
}

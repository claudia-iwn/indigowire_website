/**
 * Wires the ARP simulator page together: the clock loop, the Send form and the
 * playback controls (spec section 6, "View"). The engine holds the simulation, the
 * renderer draws it, and this file only turns user input into engine calls.
 */
import { createEngine, DEFAULT_TTL_MS } from './engine.js';
import { mountRenderer } from './renderer.js';

/** Dotted-quad IPv4, each part 0–255. */
const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
/** Longest real-time step taken in one animation frame, so a background tab doesn't leap ahead. */
const MAX_FRAME_MS = 250;

/**
 * Start the simulator inside `root` (the page's [data-arp] element).
 * @param {HTMLElement} root
 */
export function startSimulator(root) {
  /**
   * @template {Element} T
   * @param {string} selector
   * @returns {T}
   */
  const find = (selector) => {
    const el = root.querySelector(selector);
    if (!el) throw new Error(`ARP simulator: missing ${selector}`);
    return /** @type {T} */ (el);
  };

  const parts = {
    svg: /** @type {SVGSVGElement} */ (find('svg.topology')),
    bubbles: find('.bubbles'),
    caches: find('.caches'),
    macTable: find('.mac-table'),
    log: /** @type {HTMLOListElement} */ (find('.log ol')),
    live: find('.live'),
    packet: find('.packet'),
  };
  const form = /** @type {HTMLFormElement} */ (find('form.send'));
  const source = /** @type {HTMLSelectElement} */ (find('#arp-source'));
  const dest = /** @type {HTMLInputElement} */ (find('#arp-dest'));
  const app = /** @type {HTMLSelectElement} */ (find('#arp-app'));
  const error = find('#arp-dest-error');
  const play = /** @type {HTMLButtonElement} */ (find('#arp-play'));
  const step = /** @type {HTMLButtonElement} */ (find('#arp-step'));
  const speed = /** @type {HTMLSelectElement} */ (find('#arp-speed'));
  const reset = /** @type {HTMLButtonElement} */ (find('#arp-reset'));
  const ttl = /** @type {HTMLInputElement} */ (find('#arp-ttl'));
  const ttlOut = /** @type {HTMLOutputElement} */ (find('#arp-ttl-out'));

  let playing = true;
  /** @type {ReturnType<typeof createEngine>} */
  let engine;
  /** @type {ReturnType<typeof mountRenderer>} */
  let view;

  /** @param {boolean} on */
  function setPlaying(on) {
    playing = on;
    play.textContent = on ? 'Pause' : 'Play';
    step.disabled = on;
  }

  function mount() {
    engine = createEngine({ ttlMs: Number(ttl.value) * 1000 || DEFAULT_TTL_MS });
    // Inspecting a frame freezes the simulation, so the frame stays where it is.
    view = mountRenderer(parts, engine, { onInspect: () => setPlaying(false) });
    view.setYou(source.value);
  }

  // The clock: real time, scaled by the speed, drives simulated time while playing.
  let last = performance.now();
  /** @param {number} now */
  function frame(now) {
    const elapsed = Math.min(now - last, MAX_FRAME_MS);
    last = now;
    if (playing) engine.tick(elapsed * Number(speed.value));
    view.update();
    requestAnimationFrame(frame);
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault(); // a form submits nowhere here; like returning early from a handler
    const ip = dest.value.trim();
    if (!IPV4.test(ip)) {
      error.textContent = 'Enter an IPv4 address, such as 192.0.2.12.';
      dest.setAttribute('aria-invalid', 'true');
      dest.focus();
      return;
    }
    error.textContent = '';
    dest.removeAttribute('aria-invalid');
    engine.send(source.value, ip, /** @type {'ping' | 'web' | 'dns'} */ (app.value));
  });

  for (const button of root.querySelectorAll('[data-ip]')) {
    button.addEventListener('click', () => {
      dest.value = /** @type {HTMLElement} */ (button).dataset.ip ?? '';
      form.requestSubmit();
    });
  }

  source.addEventListener('change', () => view.setYou(source.value));
  play.addEventListener('click', () => setPlaying(!playing));
  step.addEventListener('click', () => {
    const next = engine.nextEventAt();
    if (next !== null) engine.tick(next - engine.state.clock);
    view.update();
  });
  reset.addEventListener('click', () => {
    view.destroy();
    mount();
  });
  ttl.addEventListener('input', () => {
    ttlOut.textContent = `${ttl.value} s`;
    engine.setTtl(Number(ttl.value) * 1000);
  });

  mount();
  setPlaying(true);
  requestAnimationFrame(frame);
}

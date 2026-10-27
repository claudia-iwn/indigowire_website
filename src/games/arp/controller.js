/**
 * Wires the ARP simulator page together: the clock loop, the mode switcher, the Send
 * form, the playback controls, the Learn lesson and the Gratuitous ARP scenarios (spec
 * section 6, "Modes" and "View"). The engine holds the simulation, the renderer draws
 * it, and this file only turns user input into engine calls.
 */
import { createEngine, DEFAULT_TTL_MS } from './engine.js';
import { LESSON, playTo, tickToward, watchStep } from './lesson.js';
import { mountRenderer } from './renderer.js';

/** @typedef {'learn' | 'sandbox' | 'garp'} Mode */
/** @type {Mode[]} */
const MODES = ['learn', 'sandbox', 'garp'];

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
  const lessonCount = find('#lesson-count');
  const lessonTitle = find('#lesson-title');
  const lessonCaption = find('.lesson-caption');
  const lessonBack = /** @type {HTMLButtonElement} */ (find('#lesson-back'));
  const lessonNext = /** @type {HTMLButtonElement} */ (find('#lesson-next'));
  const garpHost = /** @type {HTMLSelectElement} */ (find('#garp-host'));
  const garpStatus = find('.garp-status');

  /** @type {Mode} */
  let mode = 'sandbox';
  let playing = true;
  /** Learn mode: the step on show, and whether it is still playing toward its end. */
  let lessonStep = 0;
  let stepPlaying = false;
  let offStep = () => {};
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
    offStep();
    engine = createEngine({ ttlMs: Number(ttl.value) * 1000 || DEFAULT_TTL_MS });
    // Inspecting a frame freezes the simulation, so the frame stays where it is.
    view = mountRenderer(parts, engine, { onInspect: () => setPlaying(false) });
    view.setYou(mode === 'learn' ? 'H1' : source.value);
    garpStatus.textContent = '';
  }

  function remount() {
    view.destroy();
    mount();
  }

  // ---- Learn ----

  function showStep() {
    const step = LESSON[lessonStep];
    const last = LESSON.length - 1;
    lessonCount.textContent = lessonStep === 0 ? 'Introduction' : `Step ${lessonStep} of ${last}`;
    lessonTitle.textContent = step.title;
    lessonCaption.textContent = step.caption;
    lessonBack.disabled = lessonStep === 0;
    lessonNext.textContent = lessonStep === 0 ? 'Start' : lessonStep === last ? 'Start again' : 'Next';
  }

  /** Start the lesson over in a fresh simulation. */
  function startLesson() {
    remount();
    lessonStep = 0;
    stepPlaying = false;
    setPlaying(false);
    showStep();
    view.stepNote(LESSON[0].note);
  }

  /** Finish the step that is playing at once, so Next never skips what it shows. */
  function finishStep() {
    while (stepPlaying && !engine.isIdle()) tickToward(engine, Infinity);
  }

  function nextStep() {
    if (lessonStep === LESSON.length - 1) return startLesson();
    finishStep();
    offStep();
    lessonStep += 1;
    const step = LESSON[lessonStep];
    stepPlaying = true;
    view.stepNote(null);
    // Subscribe before starting: a step can end the moment it starts (H1's request leaves at once).
    offStep = watchStep(engine, step, () => {
      stepPlaying = false;
      setPlaying(false);
      view.stepNote(step.note);
    });
    showStep();
    step.start?.(engine);
    if (stepPlaying) setPlaying(true);
  }

  function previousStep() {
    const target = lessonStep - 1;
    remount();
    playTo(engine, target);
    lessonStep = target;
    stepPlaying = false;
    setPlaying(false);
    showStep();
    view.stepNote(LESSON[target].note);
    view.update();
  }

  // ---- Modes ----

  /** @param {Mode} next */
  function setMode(next) {
    mode = next;
    for (const el of root.querySelectorAll('[data-modes]')) {
      /** @type {HTMLElement} */ (el).hidden = !(
        /** @type {HTMLElement} */ (el.dataset.modes ?? '').split(' ').includes(mode)
      );
    }
    const radio = /** @type {HTMLInputElement | null} */ (
      root.querySelector(`input[name="arp-mode"][value="${mode}"]`)
    );
    if (radio) radio.checked = true;
    // The hash names the mode, so a link can open straight into one. Sandbox needs none.
    history.replaceState(null, '', mode === 'sandbox' ? location.pathname + location.search : `#${mode}`);
    if (mode === 'learn') return startLesson();
    remount();
    setPlaying(true);
  }

  for (const radio of root.querySelectorAll('input[name="arp-mode"]')) {
    radio.addEventListener('change', () =>
      setMode(/** @type {Mode} */ (/** @type {HTMLInputElement} */ (radio).value)),
    );
  }
  lessonNext.addEventListener('click', nextStep);
  lessonBack.addEventListener('click', previousStep);

  // ---- Gratuitous ARP ----

  find('#garp-announce').addEventListener('click', () => {
    engine.announce(garpHost.value);
    setPlaying(true);
  });

  /**
   * Start a scenario from warm caches: H1 and R1 have both talked to H2 recently.
   * @param {(engine: ReturnType<typeof createEngine>) => void} run
   * @param {string} status  What to watch, read out by the live region.
   */
  function scenario(run, status) {
    remount();
    engine.primeCache('H1', '192.0.2.12');
    engine.primeCache('R1', '192.0.2.12');
    run(engine);
    view.redraw();
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

  // The clock: real time, scaled by the speed, drives simulated time while playing.
  let last = performance.now();
  /** @param {number} now */
  function frame(now) {
    const elapsed = Math.min(now - last, MAX_FRAME_MS);
    last = now;
    // Learn mode stops exactly on each step's event; the other modes just run.
    if (playing) {
      if (mode === 'learn') tickToward(engine, elapsed * Number(speed.value));
      else engine.tick(elapsed * Number(speed.value));
    }
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
  reset.addEventListener('click', () => (mode === 'learn' ? startLesson() : remount()));
  ttl.addEventListener('input', () => {
    ttlOut.textContent = `${ttl.value} s`;
    engine.setTtl(Number(ttl.value) * 1000);
  });

  mount();
  const fromHash = /** @type {Mode} */ (location.hash.slice(1));
  if (MODES.includes(fromHash) && fromHash !== 'sandbox') setMode(fromHash);
  else setPlaying(true);
  requestAnimationFrame(frame);
}

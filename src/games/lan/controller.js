/**
 * Wires a LAN game's page together (spec sections 6 and 13): the clock loop, the mode
 * switcher, the Send form, the playback controls and the Learn lesson. The engine holds
 * the simulation, the renderer draws it, and this file only turns user input into engine
 * calls. Each game passes what differs as a `LanGame`.
 */
import { tickToward, watchStep } from './lesson.js';

/** Longest real-time step taken in one animation frame, so a background tab doesn't leap ahead. */
const MAX_FRAME_MS = 250;

/**
 * What a game's own mode controls get to work with.
 * @typedef {object} LanController
 * @property {(selector: string) => any} find  An element inside the simulator; throws when it is missing.
 * @property {() => any} engine  The current engine (a new one after every reset).
 * @property {() => any} view    The current view.
 * @property {() => void} remount  Start a fresh simulation.
 * @property {(on: boolean) => void} setPlaying
 */

/**
 * What a game tells the controller.
 * @typedef {object} LanGame
 * @property {string} name    For error messages, e.g. "ARP simulator".
 * @property {string} prefix  Control ids start with it (`arp-source`), and the mode radios are named `${prefix}-mode`.
 * @property {string[]} modes  Every mode value; 'learn' and 'sandbox' are built in, the others belong to the game.
 * @property {number} defaultTtlMs
 * @property {(options: { ttlMs: number }) => any} createEngine
 * @property {(parts: any, engine: any, options: { onInspect: () => void }) => any} mountView
 * @property {import('./lesson.js').LessonStep[]} lesson
 * @property {(engine: any, to: number) => void} playTo
 * @property {(address: string) => string | null} checkAddress  The error to show, or null when the address is fine.
 * @property {(engine: any, ms: number) => void} setTtl
 * @property {(control: LanController) => { onMount?: () => void }} [setup]  Wires the game's own mode controls;
 *   `onMount` runs after every fresh simulation.
 */

/**
 * Start the simulator inside `root`.
 * @param {HTMLElement} root  The page's simulator element.
 * @param {LanGame} game
 */
export function startLanSimulator(root, game) {
  /**
   * @template {Element} T
   * @param {string} selector
   * @returns {T}
   */
  const find = (selector) => {
    const el = root.querySelector(selector);
    if (!el) throw new Error(`${game.name}: missing ${selector}`);
    return /** @type {T} */ (el);
  };
  /** @param {string} name  A control by id, e.g. id('source') for #arp-source. */
  const id = (name) => find(`#${game.prefix}-${name}`);

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
  const source = /** @type {HTMLSelectElement} */ (id('source'));
  const dest = /** @type {HTMLInputElement} */ (id('dest'));
  const app = /** @type {HTMLSelectElement} */ (id('app'));
  const error = id('dest-error');
  const play = /** @type {HTMLButtonElement} */ (id('play'));
  const step = /** @type {HTMLButtonElement} */ (id('step'));
  const speed = /** @type {HTMLSelectElement} */ (id('speed'));
  const reset = /** @type {HTMLButtonElement} */ (id('reset'));
  const ttl = /** @type {HTMLInputElement} */ (id('ttl'));
  const ttlOut = /** @type {HTMLOutputElement} */ (id('ttl-out'));
  const lessonCount = find('#lesson-count');
  const lessonTitle = find('#lesson-title');
  const lessonCaption = find('.lesson-caption');
  const lessonBack = /** @type {HTMLButtonElement} */ (find('#lesson-back'));
  const lessonNext = /** @type {HTMLButtonElement} */ (find('#lesson-next'));

  /** @type {string} */
  let mode = 'sandbox';
  let playing = true;
  /** Learn mode: the step on show, and whether it is still playing toward its end. */
  let lessonStep = 0;
  let stepPlaying = false;
  let offStep = () => {};
  /** @type {any} */
  let engine;
  /** @type {any} */
  let view;
  /** @type {{ onMount?: () => void }} */
  let hooks = {};

  /** @param {boolean} on */
  function setPlaying(on) {
    playing = on;
    play.textContent = on ? 'Pause' : 'Play';
    step.disabled = on;
  }

  function mount() {
    offStep();
    engine = game.createEngine({ ttlMs: Number(ttl.value) * 1000 || game.defaultTtlMs });
    // Inspecting a frame freezes the simulation, so the frame stays where it is.
    view = game.mountView(parts, engine, { onInspect: () => setPlaying(false) });
    view.setYou(mode === 'learn' ? 'H1' : source.value);
    hooks.onMount?.();
  }

  function remount() {
    view.destroy();
    mount();
  }

  // ---- Learn ----

  function showStep() {
    const step = game.lesson[lessonStep];
    const last = game.lesson.length - 1;
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
    view.stepNote(game.lesson[0].note);
  }

  /** Finish the step that is playing at once, so Next never skips what it shows. */
  function finishStep() {
    while (stepPlaying && !engine.isIdle()) tickToward(engine, Infinity);
  }

  function nextStep() {
    if (lessonStep === game.lesson.length - 1) return startLesson();
    finishStep();
    offStep();
    lessonStep += 1;
    const step = game.lesson[lessonStep];
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
    game.playTo(engine, target);
    lessonStep = target;
    stepPlaying = false;
    setPlaying(false);
    showStep();
    view.stepNote(game.lesson[target].note);
    view.update();
  }

  // ---- Modes ----

  /** @param {string} next */
  function setMode(next) {
    mode = next;
    for (const el of root.querySelectorAll('[data-modes]')) {
      /** @type {HTMLElement} */ (el).hidden = !(
        /** @type {HTMLElement} */ (el.dataset.modes ?? '').split(' ').includes(mode)
      );
    }
    const radio = /** @type {HTMLInputElement | null} */ (
      root.querySelector(`input[name="${game.prefix}-mode"][value="${mode}"]`)
    );
    if (radio) radio.checked = true;
    // The hash names the mode, so a link can open straight into one. Sandbox needs none.
    history.replaceState(null, '', mode === 'sandbox' ? location.pathname + location.search : `#${mode}`);
    if (mode === 'learn') return startLesson();
    remount();
    setPlaying(true);
  }

  for (const radio of root.querySelectorAll(`input[name="${game.prefix}-mode"]`)) {
    radio.addEventListener('change', () => setMode(/** @type {HTMLInputElement} */ (radio).value));
  }
  lessonNext.addEventListener('click', nextStep);
  lessonBack.addEventListener('click', previousStep);

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
    const message = game.checkAddress(ip);
    if (message) {
      error.textContent = message;
      dest.setAttribute('aria-invalid', 'true');
      dest.focus();
      return;
    }
    error.textContent = '';
    dest.removeAttribute('aria-invalid');
    engine.send(source.value, ip, app.value);
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
    game.setTtl(engine, Number(ttl.value) * 1000);
  });

  hooks = game.setup?.({ find, engine: () => engine, view: () => view, remount, setPlaying }) ?? {};
  mount();
  const fromHash = location.hash.slice(1);
  if (game.modes.includes(fromHash) && fromHash !== 'sandbox') setMode(fromHash);
  else setPlaying(true);
  requestAnimationFrame(frame);
}

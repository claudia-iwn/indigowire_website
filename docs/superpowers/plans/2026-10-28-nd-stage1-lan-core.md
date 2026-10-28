# M8 Stage 1: Shared LAN Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move everything in the ARP game that is not about ARP into `src/games/lan/`, so the IPv6 Neighbor Discovery game (Stage 2, a separate plan) can reuse it, with the ARP game behaving and looking exactly as before.

**Architecture:** New DOM-free modules (`sim.js`, `ethernet.js`, `nic.js`, `switch.js`, `upstream.js`, `hops.js`, `lesson.js`) are built test-first; the DOM modules (`renderer.js`, `packet-view.js`, `controller.js`) move with `git mv` and take a per-game config object instead of importing ARP code; the page's shared markup and CSS move to `src/games/lan/LanSimulator.astro`. ARP's own modules keep **exactly the same exports and signatures**, so ARP's test files are not edited at all.

**Tech Stack:** Astro 7 (static), plain JavaScript with JSDoc, Vitest, Playwright (Chrome channel), plain CSS with tokens.

**Spec:** `docs/SPEC.md` section 13, "Stage 1: the shared LAN core" (and section 6 for the ARP game).

## Global Constraints

- JavaScript with JSDoc type comments, never TypeScript. Comments are for a Python developer learning JS: add a one-line Python comparison where JS does something non-obvious.
- Plain CSS with custom properties from `src/styles/tokens.css`; never hard-code a colour.
- No new dependency of any kind.
- Example addresses only: IPv4 from RFC 5737, IPv6 from `2001:db8::/32`, MACs `00:00:5e:00:53:xx`; 8.8.8.8 is the one exception ("the internet").
- Games: logic in DOM-free modules with Vitest tests; rendering only subscribes to engine events. Never mix the two.
- CSP: never add an `is:inline` script, a `style=""` attribute, or `set:html` with content.
- **ARP must not change.** Do not edit `src/games/arp/*.test.js` or `tests/smoke.spec.js`. Every ARP export keeps its name and signature. The visual baseline (Task 1) must match at the end (Task 9).
- Run `npm run format` before `npm run check`: Prettier decides line breaks, and `npm run lint` fails on unformatted files.
- `npm run check` must pass before each commit (lint + Vitest + pytest + build + Playwright).
- Commits go on the local branch `m8-stage1` only. Never push. Commit messages reference requirement IDs, e.g. `refactor(lan): shared simulation clock (R5, R18)`, and end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Scratch files (screenshots, size notes, the visual config) go in the scratchpad `$S` = `/private/tmp/claude-501/-Users-claudia-Indigo-Wire-Networks-Dropbox-Claudia-de-Luna-Mac-Documents-indigowire-website/a0cd1d23-3fd7-4401-9aa8-ab6ed6da566e/scratchpad`, never in the repo. `$S/node_modules` is a symlink to the project's.

## File structure

| File | Responsibility |
| --- | --- |
| `src/games/lan/sim.js` (new) | Clock, timed-action queue, events, log, frame and flow ids |
| `src/games/lan/ethernet.js` (new) | `BROADCAST_MAC`, `isGroupMac` |
| `src/games/lan/nic.js` (new) | A card's receive filter: own MAC, broadcast, joined groups |
| `src/games/lan/switch.js` (new) | SW1: learning, ageing, flooding group/unknown frames, forwarding |
| `src/games/lan/upstream.js` (new) | R1 ↔ next hop ↔ "the internet" |
| `src/games/lan/hops.js` (new) | Hop-table rows, with game hooks for kinds and notes |
| `src/games/lan/lesson.js` (new) | Learn playback: `watchStep`, `tickToward`, `playLesson` |
| `src/games/lan/packet-view.js` (moved) | Packet panel; the game supplies layouts and bytes |
| `src/games/lan/renderer.js` (moved) | Diagram, frames, panels, log, cards; the game supplies the rest |
| `src/games/lan/controller.js` (moved) | Clock loop, modes, Send form, playback, Learn |
| `src/games/lan/LanSimulator.astro` (new) | The simulator's shared markup and CSS |
| `src/games/arp/*.js` | ARP only: engine assembly, frames, hop notes, view config, Gratuitous ARP controls |
| `src/pages/learn/arp.astro` | Page text, the Gratuitous ARP panel and its CSS |

---

### Task 1: Branch and visual baseline

**Files:**
- Create (scratch): `$S/visual/visual.config.js`, `$S/visual/arp.visual.js`, `$S/visual/size-before.txt`

**Interfaces:** Produces the baseline screenshots that Task 9 compares against.

- [ ] **Step 1: Create the branch** (from `main` with the section 13 spec and this plan already committed on it; if `git status` shows them uncommitted, commit them first as the branch's first commit: `docs(spec): IPv6 Neighbor Discovery design and Stage 1 plan (R18)`)

```bash
git switch -c m8-stage1
```

- [ ] **Step 2: Write the visual config** `$S/visual/visual.config.js`

```js
// Visual baseline for the Stage 1 refactor. Not part of the repo.
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: '*.visual.js',
  snapshotPathTemplate: '{testDir}/shots/{projectName}/{arg}{ext}',
  expect: { toHaveScreenshot: { maxDiffPixels: 0 } },
  use: { baseURL: 'http://localhost:4329', channel: 'chrome' },
  projects: [
    { name: 'phone-light', use: { viewport: { width: 390, height: 844 }, colorScheme: 'light' } },
    { name: 'wide-light', use: { viewport: { width: 1280, height: 900 }, colorScheme: 'light' } },
    { name: 'wide-dark', use: { viewport: { width: 1280, height: 900 }, colorScheme: 'dark' } },
  ],
});
```

- [ ] **Step 3: Write the visual test** `$S/visual/arp.visual.js`. `page.clock` freezes `performance.now` and `requestAnimationFrame`, so the simulation is deterministic.

```js
import { test, expect } from '@playwright/test';

const ROOT = '[data-arp]';

/** @param {import('@playwright/test').Page} page @param {string} hash */
async function open(page, hash = '') {
  await page.clock.install();
  await page.goto(`/learn/arp${hash}`);
  await page.locator(`${ROOT} svg.topology .node`).first().waitFor();
}

/** @param {import('@playwright/test').Page} page @param {string} name */
async function shot(page, name) {
  await expect(page.locator(ROOT)).toHaveScreenshot(`${name}.png`, { animations: 'disabled' });
}

test('sandbox: ping H2', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'H2', exact: true }).click();
  await page.clock.runFor(1500);
  await shot(page, 'sandbox-midflight');
  await page.clock.runFor(10_000);
  await shot(page, 'sandbox-done');
});

test('sandbox: the internet', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: /the internet/ }).click();
  await page.clock.runFor(3700);
  await shot(page, 'internet-rewrite');
  await page.clock.runFor(15_000);
  await shot(page, 'internet-done');
});

test('sandbox: unused address', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'an unused address' }).click();
  await page.clock.runFor(6000);
  await shot(page, 'unused-bubble');
});

test('learn: steps 0, 3, 8', async ({ page }) => {
  await open(page, '#learn');
  await shot(page, 'learn-0');
  const next = page.locator('#lesson-next');
  for (let i = 0; i < 3; i++) {
    await next.click();
    await page.clock.runFor(5000);
  }
  await shot(page, 'learn-3');
  for (let i = 0; i < 5; i++) {
    await next.click();
    await page.clock.runFor(5000);
  }
  await shot(page, 'learn-8');
});

test('gratuitous ARP: both scenarios', async ({ page }) => {
  await open(page, '#garp');
  await page.getByRole('button', { name: /Failover/ }).click();
  await page.clock.runFor(8000);
  await shot(page, 'garp-failover');
  await page.getByRole('button', { name: /Meanwhile/ }).click();
  await page.clock.runFor(8000);
  await shot(page, 'garp-meanwhile');
});

test('inspect a frame', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'H2', exact: true }).click();
  await page.clock.runFor(10_000);
  await page.locator('.log .inspect').first().click();
  await page.locator('.packet details.bytes summary').click();
  await shot(page, 'inspect-request');
});
```

- [ ] **Step 4: Build, serve, record the baseline**

```bash
npm run build
npx astro preview --port 4329 --ignore-lock &   # leave running; stop it at the end with: kill %1
cd "$S/visual" && npx playwright test --config visual.config.js --update-snapshots
```

Expected: 18 snapshots written under `$S/visual/shots/` (6 tests × 3 projects). Run the same command again **without** `--update-snapshots`: all 18 must pass, which proves the shots are deterministic. If any differs between two runs on unchanged code, fix the test (more `runFor` time, or `mask: [page.locator('.secs')]`) before going on.

- [ ] **Step 5: Record the script size**

```bash
cd "<repo>" && for f in dist/_astro/arp.astro_astro_type_script_index_0_lang.*.js; do echo "$(wc -c < "$f") raw, $(gzip -c "$f" | wc -c) gzip"; done | tee "$S/visual/size-before.txt"
```

Expected: about `35955 raw`.

No commit in this task (nothing in the repo changed).

---

### Task 2: The simulation core (`lan/sim.js`)

**Files:**
- Create: `src/games/lan/sim.js`, `src/games/lan/sim.test.js`
- Modify: `src/games/arp/engine.js`

**Interfaces:**
- Produces: `createSim(state, { onAdvance? })` → `{ on, emit, log, schedule, tick, runUntilIdle, nextEventAt, isIdle, now, frameId, flowId }`. `state` is the game's own state object with `clock: number` and `log: {at, text}[]`; the sim moves `state.clock` and appends to `state.log`. `onAdvance()` runs each time the clock moves, before any due action, and once more at the end of `tick`. `frameId()` and `flowId()` each count 1, 2, 3…
- Type for later tasks: `/** @typedef {ReturnType<typeof import('./sim.js').createSim>} Sim */`

- [ ] **Step 1: Write the failing tests** `src/games/lan/sim.test.js`

```js
import { describe, expect, it } from 'vitest';
import { createSim } from './sim.js';

const fresh = () => {
  const state = { clock: 0, log: /** @type {{ at: number, text: string }[]} */ ([]) };
  return { state, sim: createSim(state) };
};

describe('createSim', () => {
  it('runs due actions in time order, ties in the order they were scheduled', () => {
    const { state, sim } = fresh();
    /** @type {string[]} */
    const ran = [];
    sim.schedule(200, () => ran.push(`b@${state.clock}`));
    sim.schedule(100, () => ran.push(`a@${state.clock}`));
    sim.schedule(200, () => ran.push(`c@${state.clock}`));
    sim.tick(150);
    expect(ran).toEqual(['a@100']);
    expect(state.clock).toBe(150);
    sim.tick(100);
    expect(ran).toEqual(['a@100', 'b@200', 'c@200']);
    expect(state.clock).toBe(250);
  });

  it('runs actions that due actions schedule within the same tick', () => {
    const { sim } = fresh();
    /** @type {number[]} */
    const ran = [];
    sim.schedule(10, () => sim.schedule(10, () => ran.push(sim.now())));
    sim.tick(100);
    expect(ran).toEqual([20]);
  });

  it('calls onAdvance before every due action and at the end of the tick', () => {
    const state = { clock: 0, log: [] };
    /** @type {string[]} */
    const seen = [];
    const sim = createSim(state, { onAdvance: () => seen.push(`advance@${state.clock}`) });
    sim.schedule(50, () => seen.push(`run@${state.clock}`));
    sim.tick(80);
    expect(seen).toEqual(['advance@50', 'run@50', 'advance@80']);
  });

  it('emits to subscribers until they unsubscribe', () => {
    const { sim } = fresh();
    /** @type {unknown[]} */
    const got = [];
    const off = sim.on('frame:emit', (p) => got.push(p));
    sim.emit('frame:emit', 1);
    off();
    sim.emit('frame:emit', 2);
    expect(got).toEqual([1]);
  });

  it('logs with the current time and emits a log event', () => {
    const { state, sim } = fresh();
    /** @type {unknown[]} */
    const got = [];
    sim.on('log', (entry) => got.push(entry));
    sim.tick(30);
    sim.log('hello');
    expect(state.log).toEqual([{ at: 30, text: 'hello' }]);
    expect(got).toEqual([{ at: 30, text: 'hello' }]);
  });

  it('reports the next event, idleness, and runs until idle', () => {
    const { sim } = fresh();
    expect(sim.isIdle()).toBe(true);
    expect(sim.nextEventAt()).toBe(null);
    sim.schedule(40, () => sim.schedule(60, () => {}));
    expect(sim.nextEventAt()).toBe(40);
    sim.runUntilIdle();
    expect(sim.isIdle()).toBe(true);
    expect(sim.now()).toBe(100);
  });

  it('numbers frames and flows from 1', () => {
    const { sim } = fresh();
    expect([sim.frameId(), sim.frameId(), sim.flowId(), sim.frameId(), sim.flowId()]).toEqual([1, 2, 1, 3, 2]);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/games/lan/sim.test.js`
Expected: FAIL, "Failed to resolve import './sim.js'".

- [ ] **Step 3: Write `src/games/lan/sim.js`** (the code is ARP's, moved; behaviour is identical)

```js
/**
 * The simulation core shared by the LAN games (spec section 13, "Stage 1"): the clock,
 * the queue of timed actions, events and the log. DOM-free: no window, no document.
 *
 * Time is simulated. Work is kept in a queue of timed actions, and tick(ms) advances the
 * clock and runs whatever falls due, in order, so tests can run a whole exchange instantly.
 */

/**
 * @param {{ clock: number, log: { at: number, text: string }[] }} state  The game's state:
 *   the sim moves its clock and appends to its log.
 * @param {{ onAdvance?: () => void }} [options]  Called each time the clock moves, before any
 *   due action, and at the end of each tick (the games expire entries here).
 */
export function createSim(state, { onAdvance = () => {} } = {}) {
  /** @type {Map<string, Set<(payload: any) => void>>} */
  const listeners = new Map(); // like a Python defaultdict(set)
  /** Timed actions, run in time order (then in the order they were added). */
  /** @type {{ at: number, seq: number, run: () => void }[]} */
  let queue = [];
  let seq = 0;
  let nextFrameId = 1;
  let nextFlowId = 1;

  /**
   * @param {string} event
   * @param {(payload: any) => void} handler
   * @returns {() => void} Call to unsubscribe.
   */
  function on(event, handler) {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event)?.add(handler);
    return () => listeners.get(event)?.delete(handler);
  }

  /**
   * @param {string} event
   * @param {unknown} payload
   */
  function emit(event, payload) {
    for (const handler of listeners.get(event) ?? []) handler(payload);
  }

  /** @param {string} text One plain-English line for the event log. */
  function log(text) {
    const entry = { at: state.clock, text };
    state.log.push(entry);
    emit('log', entry);
  }

  /**
   * @param {number} delay
   * @param {() => void} run
   */
  function schedule(delay, run) {
    queue.push({ at: state.clock + delay, seq: seq++, run });
  }

  /**
   * Advance the simulated clock by `ms`, running everything that falls due on the way.
   * @param {number} ms
   */
  function tick(ms) {
    const until = state.clock + ms;
    for (;;) {
      const due = queue.filter((item) => item.at <= until);
      if (due.length === 0) break;
      // The earliest action, ties broken by the order they were scheduled.
      const next = due.reduce((a, b) => (b.at < a.at || (b.at === a.at && b.seq < a.seq) ? b : a));
      queue = queue.filter((item) => item !== next);
      state.clock = next.at;
      onAdvance();
      next.run();
    }
    state.clock = until;
    onAdvance();
  }

  /** Run until nothing is left in flight. For tests and the Step control. */
  function runUntilIdle() {
    while (queue.length > 0) tick(Math.min(...queue.map((item) => item.at)) - state.clock);
  }

  /** Simulated time of the next queued action, or null when idle. The Step control ticks to it. */
  const nextEventAt = () => (queue.length ? Math.min(...queue.map((item) => item.at)) : null);

  /** True when no frame or timer is pending. */
  const isIdle = () => queue.length === 0;

  return {
    on,
    emit,
    log,
    schedule,
    tick,
    runUntilIdle,
    nextEventAt,
    isIdle,
    /** The simulated time now, in ms. */
    now: () => state.clock,
    /** A new frame id. Like a Python itertools.count(1). */
    frameId: () => nextFrameId++,
    /** A new flow id: one per send, shared by every frame it causes. */
    flowId: () => nextFlowId++,
  };
}

/** The simulation core's type, for the modules built on it. */
/** @typedef {ReturnType<typeof createSim>} Sim */
```

- [ ] **Step 4: Run the new tests**

Run: `npx vitest run src/games/lan/sim.test.js`
Expected: PASS (7 tests).

- [ ] **Step 5: Put the ARP engine on the sim.** In `src/games/arp/engine.js`:
  1. Add `import { createSim } from '../lan/sim.js';` under the existing import.
  2. Delete the `listeners` declaration (`/** @type {Map<EngineEvent, …>} */ const listeners = new Map(); …`).
  3. Delete `let queue = [];`, `let seq = 0;`, `let nextFrameId = 1;`, `let nextFlow = 1;` and the comment lines above `queue`.
  4. Delete the functions `on`, `emit`, `log`, `schedule`, `tick`, `runUntilIdle` and the consts `nextEventAt`, `isIdle` (with their doc comments).
  5. Right after the `/** @typedef {(typeof state.hosts)[string]} Host */` line, add:

```js
  // The clock, timed actions, events and log are shared with the other LAN games.
  const sim = createSim(state, { onAdvance: expire });
  const { on, emit, log, schedule } = sim; // like Python's on, emit, ... = sim.on, sim.emit, ...
```

  6. Replace every `nextFrameId++` with `sim.frameId()` and every `nextFlow++` with `sim.flowId()` (in `transmit`, `receiveData`, `sendData`, `routeOut`, `send` (twice), `announce`, `spoof`).
  7. In the returned object, replace `tick, runUntilIdle, isIdle, nextEventAt,` with `tick: sim.tick, runUntilIdle: sim.runUntilIdle, isIdle: sim.isIdle, nextEventAt: sim.nextEventAt,`.
  8. Update the file's header comment: replace the paragraph starting "Time is simulated." with `Time is simulated and kept by the shared core (src/games/lan/sim.js): every hop takes HOP_MS, and tick(ms) runs whatever falls due, in order.`

- [ ] **Step 6: Run every unit test**

Run: `npm test`
Expected: PASS, every ARP test unchanged plus the 7 new ones.

- [ ] **Step 7: Check and commit**

```bash
npm run check
git add src/games/lan/sim.js src/games/lan/sim.test.js src/games/arp/engine.js
git commit -m "refactor(lan): shared simulation clock, queue and events (R5, R18)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Ethernet, network card and switch (`lan/ethernet.js`, `lan/nic.js`, `lan/switch.js`)

**Files:**
- Create: `src/games/lan/ethernet.js`, `src/games/lan/nic.js`, `src/games/lan/switch.js`, `src/games/lan/switch.test.js`, `src/games/lan/nic.test.js`
- Modify: `src/games/arp/engine.js`, `src/games/arp/frames.js`

**Interfaces:**
- Consumes: `Sim` from Task 2 (`on`, `emit`, `log`, `schedule`, `now`, `tick`).
- Produces:
  - `BROADCAST_MAC = 'ff:ff:ff:ff:ff:ff'`, `isGroupMac(mac: string): boolean`
  - `nicDrop(host: { mac: string, groups?: Set<string> }, dst: string): null | 'not for me' | 'not my group (network card)'`
  - `createSwitch(sim, { name, table, devices, ttlMs, hopMs, deliver })` → `{ receive(frame, ingress): Device[], expire(): void, forgetPort(port: string): void }`, where `Device = { name: string, mac: string, port: string, down: boolean }`, `table: Map<string, { port: string, expiresAt: number }>`, `devices: () => Device[]`, `ttlMs: () => number`, `deliver: (device, frame) => void`.
  - Events emitted by the switch: `frame:arrive` `{frame, node, time}`, `mactable:update` `{mac, port, expiresAt}`, `frame:emit` `{frame, from, to, how: 'flood'|'forward', at, arrivesAt}`, `mactable:expire` `{mac, port}`.

- [ ] **Step 1: Write the failing NIC tests** `src/games/lan/nic.test.js`

```js
import { describe, expect, it } from 'vitest';
import { BROADCAST_MAC, isGroupMac } from './ethernet.js';
import { nicDrop } from './nic.js';

const card = { mac: '00:00:5e:00:53:12', groups: new Set(['33:33:ff:00:00:12']) };

describe('isGroupMac', () => {
  it('is true when the lowest bit of the first byte is set', () => {
    expect(isGroupMac(BROADCAST_MAC)).toBe(true);
    expect(isGroupMac('33:33:ff:00:00:12')).toBe(true);
    expect(isGroupMac('01:00:5e:00:00:01')).toBe(true);
    expect(isGroupMac('00:00:5e:00:53:12')).toBe(false);
  });
});

describe('nicDrop', () => {
  it('passes up frames for its own MAC, broadcast and its groups', () => {
    expect(nicDrop(card, '00:00:5e:00:53:12')).toBe(null);
    expect(nicDrop(card, BROADCAST_MAC)).toBe(null);
    expect(nicDrop(card, '33:33:ff:00:00:12')).toBe(null);
  });

  it('drops another host’s unicast as "not for me"', () => {
    expect(nicDrop(card, '00:00:5e:00:53:13')).toBe('not for me');
  });

  it('drops a group it has not joined in hardware', () => {
    expect(nicDrop(card, '33:33:ff:00:00:13')).toBe('not my group (network card)');
  });

  it('treats a card with no groups as joined to none', () => {
    expect(nicDrop({ mac: '00:00:5e:00:53:11' }, '33:33:ff:00:00:12')).toBe('not my group (network card)');
  });
});
```

- [ ] **Step 2: Write the failing switch tests** `src/games/lan/switch.test.js`

```js
import { describe, expect, it } from 'vitest';
import { createSim } from './sim.js';
import { createSwitch } from './switch.js';
import { BROADCAST_MAC } from './ethernet.js';

const HOP = 600;
const MAC = { H1: '00:00:5e:00:53:11', H2: '00:00:5e:00:53:12', H3: '00:00:5e:00:53:13' };

function setup() {
  const state = { clock: 0, log: /** @type {{ at: number, text: string }[]} */ ([]) };
  const sim = createSim(state);
  const devices = [
    { name: 'H1', mac: MAC.H1, port: 'Gi0/1', down: false },
    { name: 'H2', mac: MAC.H2, port: 'Gi0/2', down: false },
    { name: 'H3', mac: MAC.H3, port: 'Gi0/3', down: false },
  ];
  /** @type {Map<string, { port: string, expiresAt: number }>} */
  const table = new Map();
  /** @type {string[]} */
  const delivered = [];
  /** @type {{ event: string, payload: any }[]} */
  const seen = [];
  for (const event of ['frame:arrive', 'frame:emit', 'mactable:update', 'mactable:expire']) {
    sim.on(event, (payload) => seen.push({ event, payload }));
  }
  const sw = createSwitch(sim, {
    name: 'SW1',
    table,
    devices: () => devices,
    ttlMs: () => 60_000,
    hopMs: HOP,
    deliver: (device, frame) => delivered.push(`${device.name}:${frame.id}`),
  });
  return { state, sim, devices, table, delivered, seen, sw };
}

describe('createSwitch', () => {
  it('learns the source MAC on the ingress port, logging only the first time', () => {
    const { state, table, seen, sw } = setup();
    sw.receive({ id: 1, src: MAC.H1, dst: BROADCAST_MAC }, 'Gi0/1');
    sw.receive({ id: 2, src: MAC.H1, dst: BROADCAST_MAC }, 'Gi0/1');
    expect(table.get(MAC.H1)).toEqual({ port: 'Gi0/1', expiresAt: 60_000 });
    expect(seen.filter((e) => e.event === 'mactable:update')).toHaveLength(2);
    expect(state.log.filter((l) => l.text.includes('learns'))).toHaveLength(1);
  });

  it('floods a broadcast out every other port, delivering after one hop', () => {
    const { state, sim, delivered, seen, sw } = setup();
    const outs = sw.receive({ id: 1, src: MAC.H1, dst: BROADCAST_MAC }, 'Gi0/1');
    expect(outs.map((d) => d.name)).toEqual(['H2', 'H3']);
    const emits = seen.filter((e) => e.event === 'frame:emit').map((e) => e.payload);
    expect(emits.map((p) => [p.from, p.to, p.how, p.arrivesAt])).toEqual([
      ['SW1', 'H2', 'flood', HOP],
      ['SW1', 'H3', 'flood', HOP],
    ]);
    expect(state.log.at(-1)?.text).toBe('SW1 floods the broadcast out every other port.');
    sim.tick(HOP);
    expect(delivered).toEqual(['H2:1', 'H3:1']);
  });

  it('floods a multicast like a broadcast, because it does not track groups', () => {
    const { state, sw } = setup();
    const outs = sw.receive({ id: 1, src: MAC.H1, dst: '33:33:ff:00:00:12' }, 'Gi0/1');
    expect(outs.map((d) => d.name)).toEqual(['H2', 'H3']);
    expect(state.log.at(-1)?.text).toMatch(/^SW1 floods the multicast out every other port/);
  });

  it('floods an unknown unicast and forwards a known one out one port', () => {
    const { state, sw } = setup();
    expect(sw.receive({ id: 1, src: MAC.H2, dst: MAC.H1 }, 'Gi0/2').map((d) => d.name)).toEqual(['H1', 'H3']);
    expect(state.log.at(-1)?.text).toMatch(/has no entry for 00:00:5e:00:53:11, so it floods/);
    expect(sw.receive({ id: 2, src: MAC.H1, dst: MAC.H2 }, 'Gi0/1').map((d) => d.name)).toEqual(['H2']);
    expect(state.log.at(-1)?.text).toMatch(/knows 00:00:5e:00:53:12 is on Gi0\/2 and forwards/);
  });

  it('sends nothing out of a down port', () => {
    const { devices, sw } = setup();
    devices[2].down = true;
    expect(sw.receive({ id: 1, src: MAC.H1, dst: BROADCAST_MAC }, 'Gi0/1').map((d) => d.name)).toEqual(['H2']);
  });

  it('expires entries whose time is up', () => {
    const { state, table, seen, sw } = setup();
    sw.receive({ id: 1, src: MAC.H1, dst: BROADCAST_MAC }, 'Gi0/1');
    state.clock = 59_999;
    sw.expire();
    expect(table.has(MAC.H1)).toBe(true);
    state.clock = 60_000;
    sw.expire();
    expect(table.has(MAC.H1)).toBe(false);
    expect(seen.at(-1)).toEqual({ event: 'mactable:expire', payload: { mac: MAC.H1, port: 'Gi0/1' } });
  });

  it('forgets every MAC learnt on a port that goes down', () => {
    const { table, sw } = setup();
    sw.receive({ id: 1, src: MAC.H1, dst: BROADCAST_MAC }, 'Gi0/1');
    sw.receive({ id: 2, src: MAC.H2, dst: BROADCAST_MAC }, 'Gi0/2');
    sw.forgetPort('Gi0/2');
    expect([...table.keys()]).toEqual([MAC.H1]);
  });
});
```

- [ ] **Step 3: Run them to see them fail**

Run: `npx vitest run src/games/lan/nic.test.js src/games/lan/switch.test.js`
Expected: FAIL, unresolved imports `./ethernet.js`, `./nic.js`, `./switch.js`.

- [ ] **Step 4: Write `src/games/lan/ethernet.js`**

```js
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
```

- [ ] **Step 5: Write `src/games/lan/nic.js`**

```js
/**
 * A network card's receive filter, shared by the LAN games. DOM-free.
 * Real cards do this in hardware, so the host's software never sees a dropped frame.
 */
import { BROADCAST_MAC, isGroupMac } from './ethernet.js';

/**
 * Why the card drops a frame, or null when it passes it up to the host.
 * @param {{ mac: string, groups?: Set<string> }} host  `groups`: the multicast MACs it has joined.
 * @param {string} dst  The frame's Ethernet destination.
 * @returns {null | 'not for me' | 'not my group (network card)'}
 */
export function nicDrop(host, dst) {
  if (dst === host.mac || dst === BROADCAST_MAC || host.groups?.has(dst)) return null;
  return isGroupMac(dst) ? 'not my group (network card)' : 'not for me';
}
```

- [ ] **Step 6: Write `src/games/lan/switch.js`** (ARP's `switchReceive`, moved; the only new behaviour is the multicast branch)

```js
/**
 * SW1, shared by the LAN games (spec section 13, "Stage 1"). DOM-free. It learns the
 * source MAC on the ingress port, floods group frames (broadcast or multicast) and unknown
 * unicasts out every other port, and forwards known unicasts out one port. Like an
 * unmanaged switch, or a Catalyst with MLD snooping off (its default), it tracks no groups.
 */
import { BROADCAST_MAC, isGroupMac } from './ethernet.js';

/**
 * A device on one of the switch's ports.
 * @typedef {{ name: string, mac: string, port: string, down: boolean }} Device
 */

/**
 * @param {import('./sim.js').Sim} sim
 * @param {{ name: string, table: Map<string, { port: string, expiresAt: number }>, devices: () => Device[],
 *   ttlMs: () => number, hopMs: number, deliver: (device: any, frame: any) => void }} options
 *   `table` is the game's MAC table (the switch fills it); `deliver` is the host's receive.
 */
export function createSwitch(sim, { name, table, devices, ttlMs, hopMs, deliver }) {
  /**
   * A frame arrives on `ingress`: learn, then flood or forward.
   * @param {{ id: number, src: string, dst: string }} frame
   * @param {string} ingress
   * @returns {Device[]} The devices a copy went to.
   */
  function receive(frame, ingress) {
    const now = sim.now();
    sim.emit('frame:arrive', { frame, node: name, time: now });
    const expiresAt = now + ttlMs();
    const known = table.get(frame.src);
    table.set(frame.src, { port: ingress, expiresAt });
    sim.emit('mactable:update', { mac: frame.src, port: ingress, expiresAt });
    if (!known) sim.log(`${name} learns that ${frame.src} is on ${ingress}.`);

    const entry = table.get(frame.dst);
    /** @type {Device[]} */
    let outs;
    // Either way the frame leaves exactly as it arrived: a switch never rewrites it.
    let how = 'forward';
    // A failed host's port is down, so nothing goes out of it.
    const others = devices().filter((device) => device.port !== ingress && !device.down);
    if (isGroupMac(frame.dst)) {
      how = 'flood';
      outs = others;
      sim.log(
        frame.dst === BROADCAST_MAC
          ? `${name} floods the broadcast out every other port.`
          : `${name} floods the multicast out every other port: it doesn't track who joined which group.`,
      );
    } else if (!entry) {
      how = 'flood';
      outs = others;
      sim.log(`${name} has no entry for ${frame.dst}, so it floods the frame out every other port.`);
    } else {
      const out = devices().find((device) => device.port === entry.port);
      outs = out && entry.port !== ingress ? [out] : [];
      if (out) sim.log(`${name} knows ${frame.dst} is on ${entry.port} and forwards the frame only there.`);
    }

    for (const device of outs) {
      sim.emit('frame:emit', { frame, from: name, to: device.name, how, at: now, arrivesAt: now + hopMs });
      sim.schedule(hopMs, () => deliver(device, frame));
    }
    return outs;
  }

  /** Remove entries whose time is up. */
  function expire() {
    for (const [mac, entry] of table) {
      if (entry.expiresAt <= sim.now()) {
        table.delete(mac);
        sim.emit('mactable:expire', { mac, port: entry.port });
      }
    }
  }

  /** @param {string} port  A port went down: forget every MAC learnt there. */
  function forgetPort(port) {
    for (const [mac, entry] of table) {
      if (entry.port !== port) continue;
      table.delete(mac);
      sim.emit('mactable:expire', { mac, port: entry.port });
    }
  }

  return { receive, expire, forgetPort };
}
```

- [ ] **Step 7: Run the new tests**

Run: `npx vitest run src/games/lan`
Expected: PASS.

- [ ] **Step 8: Put the ARP engine on them.** In `src/games/arp/frames.js`, replace `export const BROADCAST_MAC = 'ff:ff:ff:ff:ff:ff';` with:

```js
import { BROADCAST_MAC } from '../lan/ethernet.js';

export { BROADCAST_MAC };
```

(keep the import at the top of the file, above the other exports). In `src/games/arp/engine.js`:
  1. Add `import { createSwitch } from '../lan/switch.js';` and `import { nicDrop } from '../lan/nic.js';`.
  2. After the `const { on, emit, log, schedule } = sim;` line, add:

```js
  const sw = createSwitch(sim, {
    name: SWITCH,
    table: state.switch.macTable,
    devices: () => Object.values(state.hosts),
    ttlMs: () => state.ttlMs,
    hopMs: HOP_MS,
    deliver: hostReceive,
  });
```

  3. Delete `nodeByPort` and the whole `switchReceive` function.
  4. Replace the body of `transmitFrame` with:

```js
    emit('frame:emit', { frame, from: host.name, to: SWITCH, at: state.clock, arrivesAt: state.clock + HOP_MS });
    schedule(HOP_MS, () => {
      const outs = sw.receive(frame, host.port);
      // An ARP request waits until every copy has arrived before its timeout starts.
      const flood = floods.get(frame.id);
      if (flood) flood.remaining = outs.length;
    });
    return frame;
```

  5. In `hostReceive`, replace `if (frame.dst !== host.mac && frame.dst !== BROADCAST_MAC) { drop(host, frame, 'not for me'); }` with:

```js
    const reason = nicDrop(host, frame.dst);
    if (reason) {
      drop(host, frame, reason);
    }
```

  (the `else if (frame.arp)` and `else` branches stay as they are).
  6. In `expire`, replace the `for (const [mac, entry] of state.switch.macTable) {…}` loop with `sw.expire();`.
  7. In `fail`, replace the `for (const [mac, entry] of state.switch.macTable) {…}` loop with `sw.forgetPort(host.port);`.
  8. `BROADCAST_MAC` is still used in `deliver` and `announce`; keep its import.

- [ ] **Step 9: Run every unit test, then check and commit**

Run: `npm test` — expected PASS, ARP tests unchanged.

```bash
npm run check
git add src/games/lan src/games/arp/engine.js src/games/arp/frames.js
git commit -m "refactor(lan): shared switch and network-card filter, multicast flooding (R5, R18)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: R1's upstream link (`lan/upstream.js`)

**Files:**
- Create: `src/games/lan/upstream.js`, `src/games/lan/upstream.test.js`
- Modify: `src/games/arp/engine.js`

**Interfaces:**
- Consumes: `Sim` (Task 2).
- Produces: `createUpstream(sim, { link, etherType, hopName, ipTtl, internetHops, hopMs, labelOf, onLan })` → `{ forward(router, frame), originate(router, dst, app, flow) }`.
  - `link: { ip: string, mac: string, nextHop: { name: string, mac: string } }` (ARP passes `TOPOLOGY.upstream`).
  - Packets carry `ip: { src, dst, ttl }`; for IPv6 the `ttl` field holds the hop limit and `hopName` is `'Hop limit'`.
  - `labelOf({ app, reply })` names a packet for the log.
  - `onLan(router, frame)` receives a packet that came back from the internet and is not for R1 itself.
  - `router` is any `{ name: string }`.

- [ ] **Step 1: Write the failing tests** `src/games/lan/upstream.test.js`

```js
import { describe, expect, it } from 'vitest';
import { createSim } from './sim.js';
import { createUpstream } from './upstream.js';

const HOP = 600;
const LINK = { ip: '198.51.100.1', mac: '00:00:5e:00:53:a1', nextHop: { name: 'next hop', mac: '00:00:5e:00:53:fe' } };
const R1 = { name: 'R1' };

function setup(hopName = 'TTL') {
  const state = { clock: 0, log: /** @type {{ at: number, text: string }[]} */ ([]) };
  const sim = createSim(state);
  /** @type {{ event: string, payload: any }[]} */
  const seen = [];
  for (const event of ['frame:emit', 'frame:arrive', 'frame:forward']) sim.on(event, (p) => seen.push({ event, payload: p }));
  /** @type {any[]} */
  const toLan = [];
  const up = createUpstream(sim, {
    link: LINK,
    etherType: 0x0800,
    hopName,
    ipTtl: 64,
    internetHops: 8,
    hopMs: HOP,
    labelOf: ({ reply }) => (reply ? 'the ICMP echo reply' : 'a ping (ICMP echo request)'),
    onLan: (router, frame) => toLan.push({ router: router.name, frame }),
  });
  return { state, sim, seen, toLan, up };
}

const lanFrame = { id: 7, dst: '00:00:5e:00:53:01', src: '00:00:5e:00:53:11', type: 0x0800, ip: { src: '192.0.2.11', dst: '8.8.8.8', ttl: 64 }, app: 'ping', flow: 3 };

describe('createUpstream', () => {
  it('rebuilds a LAN packet for the upstream link, one TTL lower', () => {
    const { state, seen, up } = setup();
    up.forward(R1, lanFrame);
    const fwd = seen.find((e) => e.event === 'frame:forward')?.payload;
    expect(fwd.out).toMatchObject({ dst: LINK.nextHop.mac, src: LINK.mac, type: 0x0800, ip: { src: '192.0.2.11', dst: '8.8.8.8', ttl: 63 }, flow: 3, parent: 7, reply: false });
    expect(fwd).toMatchObject({ frame: lanFrame, node: 'R1', to: 'next hop' });
    expect(state.log[0].text).toMatch(/lowers the TTL from 64 to 63/);
  });

  it('names the hop field it was given', () => {
    const { state, up } = setup('Hop limit');
    up.forward(R1, lanFrame);
    expect(state.log[0].text).toMatch(/lowers the Hop limit from 64 to 63/);
  });

  it('brings the answer back from the internet and hands it to the LAN', () => {
    const { sim, seen, toLan, up } = setup();
    up.forward(R1, lanFrame);
    sim.tick(HOP);
    const back = seen.filter((e) => e.event === 'frame:emit').at(-1)?.payload;
    expect(back).toMatchObject({ from: 'next hop', to: 'R1', at: HOP, arrivesAt: 2 * HOP });
    expect(back.frame).toMatchObject({ dst: LINK.mac, src: LINK.nextHop.mac, reply: true, flow: 3, ip: { src: '8.8.8.8', dst: '192.0.2.11', ttl: 56 } });
    sim.tick(HOP);
    expect(toLan).toEqual([{ router: 'R1', frame: back.frame }]);
  });

  it('does not answer an answer', () => {
    const { sim, seen, up } = setup();
    up.forward(R1, { ...lanFrame, reply: true });
    sim.runUntilIdle();
    expect(seen.filter((e) => e.event === 'frame:emit')).toHaveLength(1);
  });

  it('lets R1 send its own packet, whose answer is for R1', () => {
    const { state, sim, toLan, up } = setup();
    up.originate(R1, '8.8.8.8', 'ping', 1);
    sim.runUntilIdle();
    expect(state.log[0].text).toBe('R1 routes a ping (ICMP echo request) for 8.8.8.8 straight out its upstream link to the next hop.');
    expect(state.log.at(-1)?.text).toBe('R1 receives the ICMP echo reply from 8.8.8.8.');
    expect(toLan).toEqual([]);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/games/lan/upstream.test.js`
Expected: FAIL, unresolved import `./upstream.js`.

- [ ] **Step 3: Write `src/games/lan/upstream.js`** (ARP's gateway branch of `receiveData`, `routeOut`, the start of `upstreamReceive` and the router branch of `send`, moved)

```js
/**
 * R1's link toward the internet, shared by the LAN games (spec section 13, "Stage 1").
 * DOM-free. R1 forwards a LAN packet to the next hop; at the next hop a request is
 * answered, and the answer comes back from "the internet" to R1.
 *
 * Packets carry `ip: { src, dst, ttl }`. For IPv6 the `ttl` field holds the hop limit,
 * and `hopName` says which one the log should name.
 */

/**
 * @typedef {{ name: string }} Router
 * @typedef {{ id: number, dst: string, src: string, type: number, ip: { src: string, dst: string, ttl: number },
 *   app?: any, reply?: boolean, flow: number, parent?: number }} IpFrame
 */

/**
 * @param {import('./sim.js').Sim} sim
 * @param {{ link: { ip: string, mac: string, nextHop: { name: string, mac: string } }, etherType: number,
 *   hopName: string, ipTtl: number, internetHops: number, hopMs: number,
 *   labelOf: (packet: { app?: any, reply?: boolean }) => string, onLan: (router: any, frame: IpFrame) => void }} options
 */
export function createUpstream(sim, { link, etherType, hopName, ipTtl, internetHops, hopMs, labelOf, onLan }) {
  const to = link.nextHop.name;

  /**
   * R1 forwards a packet from the LAN: a new frame for the upstream link, one hop lower.
   * @param {Router} router
   * @param {IpFrame} frame
   */
  function forward(router, frame) {
    const { ip, app = 'ping', reply = false } = frame;
    /** @type {IpFrame} */
    const out = {
      id: sim.frameId(),
      dst: link.nextHop.mac,
      src: link.mac,
      type: etherType,
      ip: { ...ip, ttl: ip.ttl - 1 },
      app,
      reply,
      flow: frame.flow,
      parent: frame.id,
    };
    sim.emit('frame:forward', { frame, out, node: router.name, to, time: sim.now() });
    sim.log(
      `${router.name} removes the Ethernet header, looks up a route to ${ip.dst}, lowers the ${hopName} from ${ip.ttl} to ` +
        `${ip.ttl - 1} and builds a new frame for its upstream link: from its own MAC ${link.mac} to the next ` +
        `hop's ${link.nextHop.mac}. The MAC addresses change at every hop; the IP addresses stay ${ip.src} → ${ip.dst}.`,
    );
    routeOut(router, out);
  }

  /**
   * R1 sends a packet of its own to a far address.
   * @param {Router} router
   * @param {string} dst
   * @param {any} app
   * @param {number} flow
   */
  function originate(router, dst, app, flow) {
    sim.log(`${router.name} routes ${labelOf({ app })} for ${dst} straight out its upstream link to the next hop.`);
    routeOut(router, {
      id: sim.frameId(),
      dst: link.nextHop.mac,
      src: link.mac,
      type: etherType,
      ip: { src: link.ip, dst, ttl: ipTtl },
      app,
      flow,
    });
  }

  /**
   * Send a frame out the upstream link. At the next hop a request is answered.
   * @param {Router} router
   * @param {IpFrame} frame
   */
  function routeOut(router, frame) {
    sim.emit('frame:emit', { frame, from: router.name, to, at: sim.now(), arrivesAt: sim.now() + hopMs });
    sim.schedule(hopMs, () => {
      sim.emit('frame:arrive', { frame, node: to, time: sim.now() });
      const { ip } = frame;
      if (frame.reply) return;
      /** @type {IpFrame} */
      const back = {
        id: sim.frameId(),
        dst: link.mac,
        src: link.nextHop.mac,
        type: etherType,
        ip: { src: ip.dst, dst: ip.src, ttl: ipTtl - internetHops },
        app: frame.app,
        reply: true,
        flow: frame.flow,
      };
      sim.log(
        `${labelOf(back)} from ${ip.dst} comes back across the internet to the next hop, which sends it to ${router.name}.`,
      );
      sim.emit('frame:emit', { frame: back, from: to, to: router.name, at: sim.now(), arrivesAt: sim.now() + hopMs });
      sim.schedule(hopMs, () => receive(router, back));
    });
  }

  /**
   * R1 receives a packet on its upstream link: its own answer, or one for the LAN.
   * @param {Router} router
   * @param {IpFrame} frame
   */
  function receive(router, frame) {
    sim.emit('frame:arrive', { frame, node: router.name, time: sim.now() });
    if (frame.ip.dst === link.ip) {
      sim.log(`${router.name} receives ${labelOf(frame)} from ${frame.ip.src}.`);
      return;
    }
    onLan(router, frame);
  }

  return { forward, originate };
}
```

- [ ] **Step 4: Run the new tests**

Run: `npx vitest run src/games/lan/upstream.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Put the ARP engine on it.** In `src/games/arp/engine.js`:
  1. Add `import { createUpstream } from '../lan/upstream.js';`.
  2. After the `const sw = createSwitch(…);` block, add:

```js
  const uplink = createUpstream(sim, {
    link: TOPOLOGY.upstream,
    etherType: ETHERTYPE_IPV4,
    hopName: 'TTL',
    ipTtl: IP_TTL,
    internetHops: INTERNET_HOPS,
    hopMs: HOP_MS,
    labelOf,
    onLan: fromUpstream,
  });
```

  3. In `receiveData`, replace the whole `else if (host.role === 'gateway') { … routeOut(host, out); }` branch body with `uplink.forward(host, frame);` (keep the `else if (host.role === 'gateway')` condition).
  4. Delete `routeOut` and `upstreamReceive`, and add in their place:

```js
  /**
   * A packet from the internet for the LAN: R1 routes it on, using ARP first if it must.
   * @param {Host} router
   * @param {Frame} frame
   */
  function fromUpstream(router, frame) {
    const ip = /** @type {NonNullable<Frame['ip']>} */ (frame.ip);
    if (!sameSubnet(router.ip, ip.dst, router.prefix)) return;
    const packet = {
      ip: { ...ip, ttl: ip.ttl - 1 },
      app: frame.app ?? 'ping',
      reply: Boolean(frame.reply),
      flow: frame.flow,
      via: frame,
    };
    if (!router.arpCache.has(ip.dst)) {
      log(`${router.name} has a packet for ${ip.dst} on its LAN but no MAC for it, so it uses ARP too.`);
    }
    deliver(router, ip.dst, packet);
  }
```

  5. In `send`, replace the body of `if (!local && host.role === 'gateway') { … }` with:

```js
      uplink.originate(host, dstIp, app, flow);
      return;
```

- [ ] **Step 6: Run every unit test, then check and commit**

Run: `npm test` — expected PASS, ARP tests unchanged.

```bash
npm run check
git add src/games/lan/upstream.js src/games/lan/upstream.test.js src/games/arp/engine.js
git commit -m "refactor(lan): shared upstream link for R1 (R5, R18)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Hop table and Learn playback (`lan/hops.js`, `lan/lesson.js`)

**Files:**
- Create: `src/games/lan/hops.js`, `src/games/lan/hops.test.js`, `src/games/lan/lesson.js`, `src/games/lan/lesson.test.js`
- Modify: `src/games/arp/hops.js`, `src/games/arp/lesson.js`, `src/games/arp/frames.js`

**Interfaces:**
- Consumes: `BROADCAST_MAC` (Task 3), `createSim` (Task 2, in tests).
- Produces:
  - `buildHopRows(hops, { nameOf, kindOf, origin, hopName = 'TTL' })` → `HopRow[]`. `kindOf(frame): string` (`'request' | 'reply' | 'data'` for ARP); `origin(frame, from, row): string` is the note for a row a host started (not the switch, not a rebuilt frame).
  - `HopRow` (typedef in `lan/hops.js`): `{ from, to: string[], kind: string, ethDst, ethSrc, ip: {src,dst,ttl} | null, changed: ('ethDst'|'ethSrc'|'ttl')[], note, frame }`.
  - `watchStep(engine, step, onDone)`, `tickToward(engine, ms)`, `playLesson(engine, lesson, to, from = 0)`. `engine` needs only `on`, `tick`, `nextEventAt`, `isIdle`, `state.clock`.
  - `frameKind(frame)` exported from `src/games/arp/frames.js`: `'request' | 'reply' | 'data'`.

- [ ] **Step 1: Write the failing tests** `src/games/lan/hops.test.js`

```js
import { describe, expect, it } from 'vitest';
import { buildHopRows } from './hops.js';
import { BROADCAST_MAC } from './ethernet.js';

const names = /** @type {Record<string, string>} */ ({ a: 'H1', r: 'R1', u: 'R1 (upstream)', n: 'next hop' });
const game = {
  nameOf: (/** @type {string} */ mac) => names[mac] ?? mac,
  kindOf: (/** @type {any} */ f) => f.kind,
  origin: (/** @type {any} */ f, /** @type {string} */ from) => `${from} started ${f.kind}`,
};

describe('buildHopRows', () => {
  it('folds one flood into one row and asks the game for host notes', () => {
    const ask = { id: 1, kind: 'request', dst: BROADCAST_MAC, src: 'a' };
    const rows = buildHopRows(
      [
        { frame: ask, from: 'H1', to: 'SW1' },
        { frame: ask, from: 'SW1', to: 'H2', how: 'flood' },
        { frame: ask, from: 'SW1', to: 'H3', how: 'flood' },
      ],
      game,
    );
    expect(rows.map((r) => [r.from, r.to.join(', '), r.ethDst, r.note])).toEqual([
      ['H1', 'SW1', 'broadcast', 'H1 started request'],
      ['SW1', 'H2, H3', 'broadcast', 'SW1 floods a copy out every other port, unchanged.'],
    ]);
  });

  it('marks what a router rebuilt, naming the hop field', () => {
    const inFrame = { id: 1, kind: 'data', dst: 'r', src: 'a', ip: { src: 'x', dst: 'y', ttl: 64 } };
    const outFrame = { id: 2, kind: 'data', dst: 'n', src: 'u', ip: { src: 'x', dst: 'y', ttl: 63 }, parent: 1 };
    const rows = buildHopRows(
      [
        { frame: inFrame, from: 'H1', to: 'R1' },
        { frame: outFrame, from: 'R1', to: 'next hop' },
      ],
      { ...game, hopName: 'Hop limit' },
    );
    expect(rows[1].changed).toEqual(['ethDst', 'ethSrc', 'ttl']);
    expect(rows[1].note).toMatch(/Hop limit 64 → 63/);
  });
});
```

and `src/games/lan/lesson.test.js`:

```js
import { describe, expect, it } from 'vitest';
import { createSim } from './sim.js';
import { playLesson, tickToward, watchStep } from './lesson.js';

/** A tiny engine: each send emits 'frame:emit' with its label after 100 ms. */
function tinyEngine() {
  const state = { clock: 0, log: [] };
  const sim = createSim(state);
  return {
    ...sim,
    state,
    /** @param {string} label */
    send: (label) => sim.schedule(100, () => sim.emit('frame:emit', { label })),
  };
}

const LESSON = [
  { title: 'intro', caption: '', note: { node: 'H1', text: '' } },
  {
    title: 'one',
    caption: '',
    note: { node: 'H1', text: '' },
    start: (/** @type {any} */ e) => e.send('a'),
    until: { event: 'frame:emit', match: (/** @type {any} */ p) => p.label === 'a' },
  },
  {
    title: 'two',
    caption: '',
    note: { node: 'H1', text: '' },
    start: (/** @type {any} */ e) => e.send('b'),
    until: { event: 'frame:emit', match: (/** @type {any} */ p) => p.label === 'b' },
  },
];

describe('lesson playback', () => {
  it('tickToward stops exactly on the next event', () => {
    const engine = tinyEngine();
    engine.send('a');
    tickToward(engine, 1000);
    expect(engine.state.clock).toBe(100);
  });

  it('watchStep fires once, on the matching event only', () => {
    const engine = tinyEngine();
    let fired = 0;
    watchStep(engine, LESSON[2], () => fired++);
    engine.send('a');
    engine.send('b');
    engine.send('b');
    engine.runUntilIdle();
    expect(fired).toBe(1);
  });

  it('playLesson runs from one step to another', () => {
    const engine = tinyEngine();
    playLesson(engine, LESSON, 1);
    expect(engine.state.clock).toBe(100);
    playLesson(engine, LESSON, 2, 1);
    expect(engine.state.clock).toBe(200);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/games/lan/hops.test.js src/games/lan/lesson.test.js`
Expected: FAIL, unresolved imports.

- [ ] **Step 3: Write `src/games/lan/hops.js`** (ARP's `hopRows`, with the ARP-specific parts passed in)

```js
/**
 * The hop table (spec sections 6 and 13): what each device did to a frame on its way.
 * DOM-free. The renderer collects an exchange's frame:emit events and passes them here;
 * each game says what kind each frame is and what a host meant by sending it.
 */
import { BROADCAST_MAC } from './ethernet.js';

/**
 * @typedef {object} HopRow
 * @property {string} from
 * @property {string[]} to   One name, or every port a flood went out of.
 * @property {string} kind    The game's frame kind, e.g. 'request', 'reply' or 'data'.
 * @property {string} ethDst  A device name (or "broadcast"), not a raw MAC.
 * @property {string} ethSrc
 * @property {{ src: string, dst: string, ttl: number } | null} ip  IP frames only.
 * @property {('ethDst' | 'ethSrc' | 'ttl')[]} changed  What differs from the frame this one was built from.
 * @property {string} note    One line: what the device did.
 * @property {any} frame
 */

/**
 * @param {{ frame: any, from: string, to: string, how?: 'flood' | 'forward' }[]} hops  One flow's frame:emit payloads, in order.
 * @param {{ nameOf: (mac: string) => string, kindOf: (frame: any) => string,
 *   origin: (frame: any, from: string, row: HopRow) => string, hopName?: string }} game
 *   `origin` writes the note for a frame a host sent; `hopName` is 'TTL' or 'Hop limit'.
 * @returns {HopRow[]}
 */
export function buildHopRows(hops, { nameOf, kindOf, origin, hopName = 'TTL' }) {
  /** @type {HopRow[]} */
  const rows = [];
  /** Last row for each frame id, so a rebuilt frame can be compared with its parent. */
  /** @type {Map<number, HopRow>} */
  const lastRow = new Map(); // like a Python dict

  for (const { frame, from, to, how } of hops) {
    // Copies of one flood leave the switch together: one row lists every port.
    const prev = rows.at(-1);
    if (how === 'flood' && prev && prev.frame === frame && prev.from === from) {
      prev.to.push(to);
      continue;
    }
    /** @type {HopRow} */
    const row = {
      from,
      to: [to],
      kind: kindOf(frame),
      ethDst: frame.dst === BROADCAST_MAC ? 'broadcast' : nameOf(frame.dst),
      ethSrc: nameOf(frame.src),
      ip: frame.ip ? { ...frame.ip } : null,
      changed: [],
      note: '',
      frame,
    };

    const parent = frame.parent !== undefined ? lastRow.get(frame.parent) : undefined;
    if (parent) {
      if (parent.ethDst !== row.ethDst) row.changed.push('ethDst');
      if (parent.ethSrc !== row.ethSrc) row.changed.push('ethSrc');
      if (parent.ip && row.ip && parent.ip.ttl !== row.ip.ttl) row.changed.push('ttl');
      row.note =
        `${from} removed the old Ethernet header and built a new frame for the next link: ` +
        `new source and destination MACs, ${hopName} ${parent.ip?.ttl} → ${row.ip?.ttl}. The IP addresses are unchanged.`;
    } else if (from === 'SW1') {
      row.note =
        how === 'flood'
          ? 'SW1 floods a copy out every other port, unchanged.'
          : 'SW1 looks up the destination MAC and forwards it unchanged out one port.';
    } else {
      row.note = origin(frame, from, row);
    }
    rows.push(row);
    lastRow.set(frame.id, row);
  }
  return rows;
}
```

- [ ] **Step 4: Write `src/games/lan/lesson.js`** (ARP's helpers, with the lesson passed in)

```js
/**
 * Learn-mode playback shared by the LAN games (spec sections 6 and 13). DOM-free.
 *
 * Each step has a caption and the engine event it ends on. Live, the controller plays the
 * clock until that event fires (watchStep) and pauses. Back rebuilds the lesson in a fresh
 * engine and jumps straight to the step before (playLesson). The engines always do the
 * same thing for the same input, so the rebuilt state is exact.
 */

/**
 * The part of an engine the lesson needs.
 * @typedef {{ on: (event: string, handler: (payload: any) => void) => () => void, tick: (ms: number) => void,
 *   nextEventAt: () => number | null, isIdle: () => boolean, state: { clock: number } }} Engine
 */

/**
 * @typedef {object} LessonStep
 * @property {string} title
 * @property {string} caption
 * @property {{ node: string, text: string }} note  Drawn beside `node` on the diagram when the step ends.
 * @property {(engine: any) => void} [start]  Run when the step begins, e.g. a send.
 * @property {{ event: string, match: (payload: any) => boolean }} [until]
 */

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
 * Run `lesson` instantly from the end of step `from` to the end of step `to`.
 * @param {Engine} engine
 * @param {LessonStep[]} lesson
 * @param {number} to
 * @param {number} [from]  The step the engine is already at (0 for a fresh engine).
 */
export function playLesson(engine, lesson, to, from = 0) {
  for (let n = from + 1; n <= to; n++) {
    const step = lesson[n];
    let done = false;
    const off = watchStep(engine, step, () => (done = true));
    step.start?.(engine);
    // Jump from event to event; stop if the engine runs dry (it shouldn't).
    while (!done && !engine.isIdle()) tickToward(engine, Infinity);
    off();
  }
}
```

- [ ] **Step 5: Run the new tests**

Run: `npx vitest run src/games/lan`
Expected: PASS.

- [ ] **Step 6: Make ARP use them.**
  1. In `src/games/arp/frames.js`, add after `appLabel`:

```js
/**
 * A frame's kind, for its colour and the hop table.
 * @param {{ arp?: ArpPayload }} frame
 * @returns {'request' | 'reply' | 'data'}
 */
export function frameKind(frame) {
  if (!frame.arp) return 'data';
  return frame.arp.oper === ARP_REQUEST ? 'request' : 'reply';
}
```

  2. Replace all of `src/games/arp/hops.js` with:

```js
/**
 * ARP's hop table (spec section 6, "View"): the shared rows from src/games/lan/hops.js,
 * with ARP's notes for what a host meant by each frame. DOM-free.
 */
import { buildHopRows } from '../lan/hops.js';
import { appLabel, frameKind } from './frames.js';

/** @typedef {import('../lan/hops.js').HopRow} HopRow */

/**
 * What a host meant by a frame it sent.
 * @param {any} frame
 * @param {string} from
 * @param {HopRow} row
 */
function origin(frame, from, row) {
  if (row.kind === 'request') {
    return frame.arp.spa === frame.arp.tpa
      ? `${from} announces its own address to everyone (gratuitous ARP).`
      : `${from} broadcasts: who has ${frame.arp.tpa}?`;
  }
  if (row.kind === 'reply') return `${from} replies only to ${row.ethDst}: ${frame.arp.spa} is at ${frame.arp.sha}.`;
  return `${from} wraps the ${appLabel(frame).long} in a frame for ${row.ethDst}.`;
}

/**
 * @param {{ frame: any, from: string, to: string, how?: 'flood' | 'forward' }[]} hops  One flow's frame:emit payloads, in order.
 * @param {(mac: string) => string} nameOf  Turns a MAC into a device name for the table.
 * @returns {HopRow[]}
 */
export function hopRows(hops, nameOf) {
  return buildHopRows(hops, { nameOf, kindOf: frameKind, origin });
}
```

  3. In `src/games/arp/lesson.js`: replace the three functions `watchStep`, `tickToward` and `playTo` (with their doc comments) with:

```js
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
```

  and add at the top, under the header comment: `import { playLesson, tickToward, watchStep } from '../lan/lesson.js';`. Shorten the header comment's second paragraph to: `Each step has a caption and the engine event it ends on; the shared playback (src/games/lan/lesson.js) plays to it.`

- [ ] **Step 7: Run every unit test, then check and commit**

Run: `npm test` — expected PASS, ARP tests unchanged.

```bash
npm run check
git add src/games/lan src/games/arp/hops.js src/games/arp/lesson.js src/games/arp/frames.js
git commit -m "refactor(lan): shared hop table and Learn playback (R5, R18)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Renderer and packet view move to `lan/`

**Files:**
- Move: `src/games/arp/renderer.js` → `src/games/lan/renderer.js`, `src/games/arp/packet-view.js` → `src/games/lan/packet-view.js`
- Create: `src/games/arp/renderer.js` (the ARP view config)

**Interfaces:**
- Consumes: `HopRow` (Task 5), ARP's `frameKind`, `describeFrame`, `appLabel`, `breakdown`, `arpFields`, `dataFields`, `encodeArpFrame`, `encodeEthernetHeader`, `hopRows`, `HOP_MS`, `TOPOLOGY`.
- Produces:
  - `mountLanRenderer(parts, engine, game, { onInspect }?)` with the same return value as today's `mountRenderer` (`update`, `inspect`, `setYou`, `redraw`, `stepNote`, `destroy`).
  - `NEXT_HOP = 'next hop'` and the `Layout` typedef, exported from `lan/renderer.js`.
  - `mountPacketView(panel, { onFollow, game })`.
  - The `LanView` typedef (in `lan/renderer.js`):

```js
/**
 * What a game tells the shared view.
 * @typedef {object} LanView
 * @property {Record<'wide' | 'narrow', Layout>} layouts
 * @property {{ mac: string, nextHop: { mac: string } }} upstream  R1's upstream MAC and the next hop's, for names.
 * @property {number} hopMs
 * @property {string} hopName  'TTL' or 'Hop limit'.
 * @property {(node: any) => string[]} addressLines  Lines under a node's name, above its MAC; the first heads its cache.
 * @property {(frame: any) => string} frameKind  CSS class: 'request', 'reply' or 'data'.
 * @property {(frame: any) => string} frameLabel  The short label on a moving frame.
 * @property {(frame: any) => string} describe  One line, for the log, labels and the packet view.
 * @property {{ columns: string[], rows: (host: any) => { key: string, values: string[], expiresAt?: number }[] }} cache
 *   A row with `expiresAt` gets a countdown bar in its last cell.
 * @property {Record<string, (payload: any) => { host: string, text: string }>} bubbles  Engine event → speech bubble.
 * @property {(hops: any[], nameOf: (mac: string) => string) => import('./hops.js').HopRow[]} hopRows
 * @property {PacketGame} packet
 */
```

  - The `PacketGame` typedef (in `lan/packet-view.js`):

```js
/**
 * What a game tells the packet view.
 * @typedef {object} PacketGame
 * @property {(frame: any) => string} kindOf
 * @property {(frame: any) => string} describe
 * @property {(frame: any) => { strip: any[], zoom: { title: string, layer: string, rows: any[][] } }} breakdown
 * @property {(frame: any) => { name: string, value: string, offset: number, length: number }[]} fields
 * @property {(frame: any) => Uint8Array} bytes
 * @property {(frame: any, bytes: Uint8Array) => string} bytesSummary  The "Bytes" fold's summary line.
 * @property {(row: import('./hops.js').HopRow) => string} hopFrame  The hop table's Frame column.
 * @property {string} hopName  The hop table's TTL column heading.
 */
```

- [ ] **Step 1: Move the files**

```bash
git mv src/games/arp/renderer.js src/games/lan/renderer.js
git mv src/games/arp/packet-view.js src/games/lan/packet-view.js
```

- [ ] **Step 2: Generalise `src/games/lan/packet-view.js`**
  1. Header comment: replace "(spec section 6, "View")" with "(spec sections 6 and 13), shared by the LAN games", and "(Ethernet header, ARP or IPv4, padding, FCS)" with "(Ethernet header, inner headers, padding, FCS)". Last line: "DOM code; each game supplies its layouts (breakdown) and bytes, which are tested without a browser."
  2. Delete the `import … from './frames.js'` line and the `kindOf` const. Add the `PacketGame` typedef above.
  3. Signature: `@param {{ onFollow: () => void, game: PacketGame }} options` and `export function mountPacketView(panel, { onFollow, game }) {`.
  4. In `show`: `const kind = game.kindOf(frame);`, `title.textContent = game.describe(frame);`, `const { strip, zoom } = game.breakdown(frame);`, delete `const isArp = …`, then `const fields = game.fields(frame);` and `const bytes = game.bytes(frame);`. The `summary` text becomes `game.bytesSummary(frame, bytes)`.
  5. In `setHops`: the `@param` type becomes `import('./hops.js').HopRow[]`; in the heading list replace `'TTL'` with `game.hopName`; replace `td(row.kind === 'data' ? row.frame.app : \`ARP ${row.kind}\`)` with `td(game.hopFrame(row))`.

- [ ] **Step 3: Generalise `src/games/lan/renderer.js`**
  1. Header comment's first sentence becomes: "The LAN games' view (spec sections 6 and 13): SVG topology, frames moving along the links, the cache and MAC-table panels, the event log, the packet view and R1's before/after card. Each game passes what differs as a `LanView`."
  2. Replace the four imports with `import { mountPacketView } from './packet-view.js';`.
  3. `const NEXT_HOP = 'next hop';` becomes `export const NEXT_HOP = 'next hop';`. Export the `Layout` and `Point` typedefs unchanged.
  4. **Cut** the `LAYOUTS` const (with its doc comment) — it moves to ARP in Step 4. Cut `frameLabel` and `frameKind` (they move too). Add the `LanView` typedef.
  5. `mountRenderer(parts, engine, { onInspect } = {})` becomes `mountLanRenderer(parts, engine, game, { onInspect } = {})`, documented `@param {any} engine` and `@param {LanView} game`. Inside, every `LAYOUTS.narrow` / `LAYOUTS.wide` becomes `game.layouts.narrow` / `game.layouts.wide` (three places: initial layout, `stepNote`'s `layout === LAYOUTS.narrow`, `onLayout`).
  6. In `drawTopology`, replace the `addr` text line and the `mac` line with:

```js
      // Address lines under the name (ARP: the IP; ND: global and link-local), then the MAC.
      const lines = game.addressLines(node);
      lines.forEach((text, i) => {
        group.append(svg('text', { class: 'addr', x: p.x, y: p.y + 6 + 18 * i, 'text-anchor': 'middle' }, text));
      });
      const mac = svg(
        'text',
        { class: 'addr mac', x: p.x, y: p.y + 6 + 18 * lines.length, 'text-anchor': 'middle' },
        node.mac,
      );
```

  7. In `addSegment`: `const kind = game.frameKind(frame);`, `` 'aria-label': `Inspect ${game.describe(frame)}` ``, and `game.frameLabel(frame)` for the text.
  8. Replace `drawCaches` with:

```js
  /** Rebuild every host's cache table. */
  function drawCaches() {
    parts.caches.replaceChildren();
    for (const host of Object.values(engine.state.hosts)) {
      const section = html('section', { class: 'cache', 'data-host': host.name });
      const heading = html('h3', {}, `${host.name} `);
      heading.append(html('span', { class: 'muted' }, game.addressLines(host)[0]));
      section.append(heading);
      const entries = game.cache.rows(host);
      if (entries.length === 0) {
        section.append(html('p', { class: 'empty' }, 'Empty'));
      } else {
        const table = html('table');
        table.append(row('th', game.cache.columns));
        for (const entry of entries) table.append(row('td', entry.values, entry.expiresAt, entry.key));
        section.append(table);
      }
      parts.caches.append(section);
    }
  }
```

  9. In `logLine`: `describeFrame(frame)` → `game.describe(frame)`.
  10. In `nameOf`: `TOPOLOGY.upstream.mac` → `game.upstream.mac`, `TOPOLOGY.upstream.nextHop.mac` → `game.upstream.nextHop.mac`.
  11. `mountPacketView(parts.packet, { onFollow: … })` gains `game: game.packet,` after `onFollow`.
  12. `hopRows(` → `game.hopRows(` (two places: `showFrame` and the `frame:emit` handler).
  13. In `rewriteCard`: `change('TTL', …)` → `change(game.hopName, …)` and `3 * HOP_MS` → `3 * game.hopMs`.
  14. In the event subscriptions, delete the `arp:timeout` and `ip:conflict` entries, and after the `offs.push(…);` call add:

```js
  // The game's own events that deserve a speech bubble (ARP: no reply, duplicate IP).
  for (const [event, make] of Object.entries(game.bubbles)) {
    offs.push(
      engine.on(event, (payload) => {
        const { host, text } = make(payload);
        bubble(host, text);
      }),
    );
  }
```

- [ ] **Step 4: Write `src/games/arp/renderer.js`** (the ARP view config)

```js
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
```

then paste the `LAYOUTS` const cut in Step 3 (unchanged, still `export const LAYOUTS`, typed `/** @type {Record<'wide' | 'narrow', import('../lan/renderer.js').Layout>} */`), then the `frameLabel` function cut in Step 3 (unchanged), then:

```js
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
    rows: (host) => [...host.arpCache].map(([ip, entry]) => ({ key: ip, values: [ip, entry.mac, ''], expiresAt: entry.expiresAt })),
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
```

`frameLabel` still uses `appLabel`; nothing else in this file does, so the import list above is exactly what it needs. `[NEXT_HOP]` in `LAYOUTS` now refers to the imported const.

- [ ] **Step 5: Check, look at it, commit**

```bash
npm run check
```

Expected: PASS (the Playwright ARP tests exercise every mode, the packet view, the hop table and the bubbles). Then rebuild, restart the preview on port 4329 and run the visual test from Task 1 (`cd "$S/visual" && npx playwright test --config visual.config.js`): all 18 must pass. Fix any difference before committing.

```bash
git add -A src/games/arp src/games/lan
git commit -m "refactor(lan): shared renderer and packet view, ARP passes its view config (R5, R18)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Controller moves to `lan/`

**Files:**
- Move: `src/games/arp/controller.js` → `src/games/lan/controller.js`
- Create: `src/games/arp/controller.js` (ARP's config and Gratuitous ARP controls)

**Interfaces:**
- Consumes: `tickToward`, `watchStep` (Task 5); ARP's `createEngine`, `DEFAULT_TTL_MS`, `LESSON`, `playTo`, `mountRenderer`.
- Produces: `startLanSimulator(root, game)` with the `LanGame` and `LanController` typedefs below; ARP keeps `startSimulator(root)`.

- [ ] **Step 1: Move the file**

```bash
git mv src/games/arp/controller.js src/games/lan/controller.js
```

- [ ] **Step 2: Generalise `src/games/lan/controller.js`**
  1. Header comment: "Wires a LAN game's page together (spec sections 6 and 13): the clock loop, the mode switcher, the Send form, the playback controls and the Learn lesson. The engine holds the simulation, the renderer draws it, and this file only turns user input into engine calls. Each game passes what differs as a `LanGame`."
  2. Imports become just `import { tickToward, watchStep } from './lesson.js';`. Delete `Mode`, `MODES` and `IPV4`. Keep `MAX_FRAME_MS`.
  3. Add the typedefs:

```js
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
```

  4. `export function startSimulator(root)` becomes `export function startLanSimulator(root, game)`, documented `@param {HTMLElement} root  The page's simulator element.` and `@param {LanGame} game`. In `find`, the error becomes `` `${game.name}: missing ${selector}` ``. Add right after `find`:

```js
  /** @param {string} name  A control by id, e.g. id('source') for #arp-source. */
  const id = (name) => find(`#${game.prefix}-${name}`);
```

  and use it for `source`, `dest`, `app`, `error` (`id('dest-error')`), `play`, `step`, `speed`, `reset`, `ttl`, `ttlOut` (`id('ttl-out')`). Delete `garpHost` and `garpStatus`.
  5. `let mode = 'sandbox';` keeps its value; type it `/** @type {string} */`. Engine and view become `/** @type {any} */ let engine;` and `/** @type {any} */ let view;`. Add `/** @type {{ onMount?: () => void }} */ let hooks = {};`.
  6. `mount()` becomes:

```js
  function mount() {
    offStep();
    engine = game.createEngine({ ttlMs: Number(ttl.value) * 1000 || game.defaultTtlMs });
    // Inspecting a frame freezes the simulation, so the frame stays where it is.
    view = game.mountView(parts, engine, { onInspect: () => setPlaying(false) });
    view.setYou(mode === 'learn' ? 'H1' : source.value);
    hooks.onMount?.();
  }
```

  7. In the Learn functions replace `LESSON` with `game.lesson` everywhere, and `playTo(engine, target)` with `game.playTo(engine, target)`.
  8. In `setMode`: the parameter type is `{string}`; the radio selector becomes `` `input[name="${game.prefix}-mode"][value="${mode}"]` ``; and the listener loop's selector becomes `` `input[name="${game.prefix}-mode"]` `` with `setMode(/** @type {HTMLInputElement} */ (radio).value)`.
  9. Delete the whole "Gratuitous ARP" block (the `#garp-announce` listener, `scenario`, `#garp-failover`, `#garp-meanwhile`).
  10. In the form's submit handler, replace the `if (!IPV4.test(ip)) { error.textContent = 'Enter an IPv4 address, such as 192.0.2.12.'; …` opening with:

```js
    const message = game.checkAddress(ip);
    if (message) {
      error.textContent = message;
```

  (the `aria-invalid`, `focus` and `return` lines stay), and `engine.send(source.value, ip, /** @type {…} */ (app.value))` becomes `engine.send(source.value, ip, app.value)`.
  11. The `ttl` listener calls `game.setTtl(engine, Number(ttl.value) * 1000);` instead of `engine.setTtl(…)`.
  12. Just before the final `mount();` add:

```js
  hooks =
    game.setup?.({ find, engine: () => engine, view: () => view, remount, setPlaying }) ?? {};
```

  13. `MODES.includes(fromHash)` becomes `game.modes.includes(fromHash)`, and `fromHash` is `location.hash.slice(1)` with no cast.

- [ ] **Step 3: Write `src/games/arp/controller.js`**

```js
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
```

(Copy the two scenario status strings and the failover log line exactly from the moved file before deleting them in Step 2.9; they must stay byte-for-byte the same.)

- [ ] **Step 4: Check, compare, commit**

```bash
npm run check
```

Then rebuild, restart the preview on 4329, run the visual test: all 18 pass.

```bash
git add -A src/games/arp src/games/lan
git commit -m "refactor(lan): shared controller, ARP passes its game config and GARP controls (R5, R18)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: The simulator's markup and CSS (`LanSimulator.astro`) and neutral colour names

**Files:**
- Create: `src/games/lan/LanSimulator.astro`
- Modify: `src/pages/learn/arp.astro`, `src/styles/tokens.css`

**Interfaces:**
- Produces: `<LanSimulator>` with props:

```js
/**
 * @typedef {object} Props
 * @property {string} prefix  'arp' or 'nd': control ids, the mode radios' name, the root's class and data-<prefix> attribute.
 * @property {{ value: string, label: string }[]} modes
 * @property {string} sendModes  The modes that show the Send form, Step and the TTL slider, e.g. "sandbox garp".
 * @property {{ name: string, label: string }[]} hosts  The From list: value and text.
 * @property {{ label: string, value: string, inputmode: string }} dest  The To field.
 * @property {{ label: string, value: string }[]} quick  The "Try:" buttons (`data-ip`).
 * @property {{ label: string, min: number, max: number, value: number }} ttl  The slider, in seconds.
 * @property {{ kind: 'request' | 'reply' | 'data', label: string }[]} legend  Frame kinds in the legend.
 * @property {string} diagramLabel  The diagram's aria-label.
 * @property {string} cacheTitle    e.g. "ARP caches".
 */
```

  and one named slot, `mode-panels`, for the game’s own mode sections (rendered after the Learn section, before the Send form).

- [ ] **Step 1: Rename the two colour tokens.** In `src/styles/tokens.css`, rename `--color-arp-request` to `--color-request` and `--color-arp-reply` to `--color-reply` (values unchanged), with a comment above them: `/* Request and reply frames: ARP request/reply, ND solicitation/advertisement. */`. In `src/pages/learn/arp.astro` replace every `var(--color-arp-request)` with `var(--color-request)` and every `var(--color-arp-reply)` with `var(--color-reply)` (12 places). Check none remain: `grep -rn "color-arp" src` prints nothing.

- [ ] **Step 2: Create `src/games/lan/LanSimulator.astro`.** Frontmatter: a doc comment ("The LAN games' simulator markup (spec sections 6 and 13): modes, the Learn panel, the Send form, playback, the diagram with its tables, the packet view and the log. The game's own mode panels go in the `mode-panels` slot. src/games/lan/controller.js brings it to life."), the `Props` typedef above, and `const { prefix, modes, sendModes, hosts, dest, quick, ttl, legend, diagramLabel, cacheTitle } = Astro.props;`.

  Body: **move** the markup of `src/pages/learn/arp.astro` from `<div class="arp" data-arp>` to its closing `</div>` (lines 95–302 today) into the component, then make exactly these changes:
  - The root: `<div class={`lan ${prefix}`} {...{ [`data-${prefix}`]: '' }}>` (the spread gives ARP `data-arp`, which the page script and the tests use).
  - Radios: `name={`${prefix}-mode`}`, mapping `modes`.
  - Replace the whole `<section class="garp" …>…</section>` with `<slot name="mode-panels" />`.
  - The form: `data-modes={sendModes}`; ids `${prefix}-source`, `${prefix}-dest`, `${prefix}-app`, `${prefix}-dest-error` (and `for=`/`aria-describedby=` to match); the From options map `hosts` (`<option value={host.name}>{host.label}</option>`); the To label is `{dest.label}`, `inputmode={dest.inputmode}`, `value={dest.value}`; the "Try:" buttons map `quick` (`<button type="button" data-ip={q.value}>{q.label}</button>`).
  - Playback: ids `${prefix}-play`, `${prefix}-step`, `${prefix}-speed`, `${prefix}-reset`, `${prefix}-ttl`, `${prefix}-ttl-out`; Step and the TTL label get `data-modes={sendModes}`; the TTL label text is `{ttl.label}`, and the range uses `min={ttl.min} max={ttl.max} value={ttl.value}` (step stays `10`), the output shows `{ttl.value} s`.
  - The SVG's `aria-label={diagramLabel}`; the legend's three frame-kind items map `legend` (`<li><span class={`swatch ${item.kind}`} aria-hidden="true"></span> {item.label}</li>`), after the three fixed items (User device, Network infrastructure, You).
  - The caches heading: `{cacheTitle}`.

  Style: a `<style>` block holding every rule of the page's `<style>` **except** those listed in Step 3 as staying, with `.arp` replaced by `.lan` (including `:global(html:not(.js)) .lan`). Rules that combine a shared and a GARP selector (`.lesson, .garp {`, `.lesson h2, .garp h2 {`, `.lesson-nav, .garp-row {`) keep only their shared selector here.

- [ ] **Step 3: Slim the page.** In `src/pages/learn/arp.astro`:
  - Import the component: `import LanSimulator from '../../games/lan/LanSimulator.astro';`.
  - Frontmatter: add the props data:

```js
const hostOptions = hosts.map((node) => ({ name: node.name, label: `${node.name} (${node.ip})` }));
```

  - In place of the moved markup:

```astro
  <LanSimulator
    prefix="arp"
    modes={MODES}
    sendModes="sandbox garp"
    hosts={hostOptions}
    dest={{ label: 'To IP address', value: '192.0.2.12', inputmode: 'decimal' }}
    quick={[
      { label: 'H2', value: '192.0.2.12' },
      { label: 'an unused address', value: '192.0.2.99' },
      { label: 'the internet (8.8.8.8)', value: '8.8.8.8' },
    ]}
    ttl={{ label: 'Cache TTL', min: MIN_TTL_MS / 1000, max: MAX_TTL_MS / 1000, value: ttlSeconds }}
    legend={[
      { kind: 'request', label: 'ARP request' },
      { kind: 'reply', label: 'ARP reply' },
      { kind: 'data', label: 'IP data (ping, web, DNS)' },
    ]}
    diagramLabel="Network diagram: three user devices and the router R1 on switch SW1"
    cacheTitle="ARP caches"
  >
    <section slot="mode-panels" class="garp" data-modes="garp" aria-labelledby="garp-title" hidden>
      <!-- the existing Gratuitous ARP section's contents, unchanged -->
    </section>
  </LanSimulator>
```

  (the comment stands for the section's existing inner markup, moved as is; do not leave the comment in the file).
  - The page's `<style>` keeps only: `.notice`, `.lesson-text …`, `.dates`, every `.garp…` rule, the GARP halves of the three combined rules, and a copy of the base control rules the GARP panel needs (`button`, `button:…`, `button.primary`, `select`, `input`, `select:…`/`input:…` focus rules and `[data-modes][hidden]`), with a comment: `/* The base control rules again: the GARP panel is slotted into LanSimulator, so it keeps this page's scope and not the component's. */`.

- [ ] **Step 4: Check and compare**

```bash
npm run check
```

Then rebuild, restart the preview on 4329, run the visual test: all 18 must pass. Also confirm the built page has the same controls: `grep -o 'id="arp-[a-z-]*"' dist/learn/arp.html | sort -u | wc -l` prints 10, as on `main`.

- [ ] **Step 5: Commit**

```bash
git add -A src/games/lan/LanSimulator.astro src/pages/learn/arp.astro src/styles/tokens.css
git commit -m "refactor(lan): shared simulator markup and CSS; neutral request/reply colour names (R5, R18)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Prove ARP is unchanged, and record it

**Files:**
- Modify: `docs/SPEC.md` (M8's first item), `CLAUDE.md` (Architecture rules, "Games")

- [ ] **Step 1: Unit tests unchanged.** `git diff main --stat -- src/games/arp/*.test.js tests/smoke.spec.js` prints nothing.

- [ ] **Step 2: Visual match.** `npm run build`, restart the preview on 4329, `cd "$S/visual" && npx playwright test --config visual.config.js`: 18 passed.

- [ ] **Step 3: Script size.** Run Task 1 Step 5's size command, writing `$S/visual/size-after.txt`. The raw and gzip sizes must be within 5% of `size-before.txt` (the config objects add a little; the moved code adds nothing).

- [ ] **Step 4: Lighthouse on the ARP page.** `npm run lighthouse`: `/learn/arp` still has Performance ≥ 95 and Accessibility 100.

- [ ] **Step 5: Record it.**
  - `docs/SPEC.md`, section 10, M8: tick the first item and append `Done <date>: src/games/lan/ (sim, ethernet, nic, switch, upstream, hops, lesson, renderer, packet view, controller, LanSimulator.astro); ARP unchanged (tests untouched, 18 screenshots match, script <before> → <after> bytes)` with the real date and sizes.
  - `docs/SPEC.md`, section 13, "Stage 1": change "`--color-arp-request` and `--color-arp-reply` become" to "`--color-arp-request` and `--color-arp-reply` became", and add one bullet: "**`src/games/lan/LanSimulator.astro`** holds the simulator's markup and CSS; each game passes its modes, hosts, quick picks, slider, legend and labels as props, and its own mode panels in the `mode-panels` slot."
  - `CLAUDE.md`, "Architecture rules", the **Games** bullet: append "The LAN games share a core in `src/games/lan/` (clock, switch, network card, upstream link, hop table, Learn playback, renderer, packet view, controller, `LanSimulator.astro`); a game passes what differs as a config object (spec section 13)."

- [ ] **Step 6: Check and commit**

```bash
npm run check
git add docs/SPEC.md CLAUDE.md
git commit -m "docs: Stage 1 shared LAN core done (R5, R18)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Stop the preview server (`kill %1`, or `lsof -ti :4329 | xargs kill`). The branch stays local until the owner says "commit and push".

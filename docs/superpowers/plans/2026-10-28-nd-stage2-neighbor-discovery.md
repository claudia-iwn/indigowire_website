# M8 Stage 2: IPv6 Neighbor Discovery Game Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `/learn/nd`, "How IPv6 Neighbor Discovery works": the IPv6 counterpart of the ARP game, on the same LAN and the shared core in `src/games/lan/`, with Learn, Sandbox and "DAD and unsolicited NA" modes.

**Architecture:** Task 1 makes the small changes to the shared core that the final Stage 1 review listed (spec section 13, "Stage 1", last bullets), proven against the ARP screenshot baseline. Then the ND game is built test-first in `src/games/nd/`: `ipv6.js` (addresses), `frames.js` (bytes, checksum, packet-view layouts), `engine.js` (Neighbor Discovery and DAD on the shared sim, switch, network card and upstream link), `hops.js` and `lesson.js`, then the view config, controller and page, then shipping (course placement, share card, tests, docs).

**Tech Stack:** Astro 7 (static), plain JavaScript with JSDoc, Vitest, Playwright (Chrome channel), plain CSS with tokens. Scapy only as a one-off reference (`uv run --with scapy`), never a dependency.

**Spec:** `docs/SPEC.md` section 13, "Feature spec: IPv6 Neighbor Discovery" (and section 6 for what the ARP game does, section 12 for the course).

## Global Constraints

- JavaScript with JSDoc type comments, never TypeScript. Comments are for a Python developer learning JS: add a one-line Python comparison where JS does something non-obvious.
- Plain CSS with custom properties from `src/styles/tokens.css`; never hard-code a colour.
- No new dependency of any kind. Python only through uv.
- Example addresses only: IPv6 from `2001:db8::/32` (plus `fe80::/10`, `ff02::/16` and `::`, which are protocol addresses), MACs `00:00:5e:00:53:xx` (plus IPv6 multicast MACs `33:33:xx:xx:xx:xx`), made-up domains under `.example`. The game's internet address is `2001:db8:8888::8`. Never a real public address.
- Games: logic in DOM-free modules with Vitest tests; rendering only subscribes to engine events. Never mix the two.
- CSP: never add an `is:inline` script, a `style=""` attribute (set styles through `el.style`), or `set:html` with content.
- Search (N11): every page passes `BaseLayout` a unique `title`, a `description` of at least 70 characters, breadcrumbs and its structured data.
- **ARP must not change**, in behaviour or looks: the 18-shot visual baseline in `$S/visual` must still pass after Task 1 and at the end. Do not edit `src/games/arp/*.test.js`.
- `npm run format` before `npm run check`; `npm run check` must pass before each commit.
- Commits go on the local branch `m8-stage2` only. Never push. Commit messages reference requirement IDs, e.g. `feat(nd): Neighbor Discovery engine (R18)`, and end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Scratch files go in `$S` = `/private/tmp/claude-501/-Users-claudia-Indigo-Wire-Networks-Dropbox-Claudia-de-Luna-Mac-Documents-indigowire-website/a0cd1d23-3fd7-4401-9aa8-ab6ed6da566e/scratchpad`, never in the repo. The ARP visual test: build, serve `dist/` with `npx astro preview --port 4329 --ignore-lock` (background), then `cd "$S/visual" && npx playwright test --config visual.config.js` (never `--update-snapshots`): 18 passed.

## File structure

| File | Responsibility |
| --- | --- |
| `src/games/lan/*` (modify) | Core adjustments: `LanEngine` type, per-row countdown lifetimes, `cache:stale` and `host:change` redraws, address font size, packet notes, one `hopName`, neutral layer CSS, slotted-panel controls, prefix-free To field |
| `src/games/nd/ipv6.js` (new) | Parse, format (RFC 5952), solicited-node group, multicast MAC, prefix tests |
| `src/games/nd/frames.js` (new) | ND and echo frames: bytes, ICMPv6 checksum, field tree, packet-view layout, labels |
| `src/games/nd/engine.js` (new) | Topology, Neighbor Discovery, neighbour cache (REACHABLE/STALE), probes, retries, off-link via `fe80::1`, DAD, unsolicited NA |
| `src/games/nd/hops.js` (new) | ND's hop-table notes |
| `src/games/nd/lesson.js` (new) | The Learn lesson: introduction and 9 steps |
| `src/games/nd/renderer.js` (new) | ND's `LanView` config |
| `src/games/nd/controller.js` (new) | ND's `LanGame` config, the Sandbox fail control and the DAD scenarios |
| `src/pages/learn/nd.astro` (new) | The page |
| `src/content/learn/nd.md` (new) | Title, summary, description, tags |

---

### Task 1: Core adjustments (shared LAN core)

**Files:**
- Modify: `src/games/lan/sim.js`, `src/games/lan/sim.test.js`, `src/games/lan/switch.test.js`, `src/games/lan/lesson.test.js`, `src/games/lan/upstream.js`, `src/games/lan/renderer.js`, `src/games/lan/packet-view.js`, `src/games/lan/controller.js`, `src/games/lan/LanSimulator.astro`, `src/games/arp/renderer.js`, `src/pages/learn/arp.astro`

**Interfaces:**
- Produces (later tasks rely on these names exactly):
  - `LanEngine` and `LanHost` typedefs at the end of `src/games/lan/sim.js`.
  - `Layout.addrSize?: number`: font size in px for the address lines, when set.
  - `LanView.lifetime: { cache: (engine) => number, mac: (engine) => number }`: the full length of a countdown, in ms, per table. **Required.**
  - The renderer redraws the caches on `cache:update`, `cache:expire` and `cache:stale` (payload `{ host, ip }`, flashing the row whose key is `ip`), and redraws the diagram and caches on `host:change` (payload `{ host }`).
  - `PacketGame.notes?: (frame) => string[]`: short notes shown under the header rows.
  - `mountPacketView(panel, { onFollow, game, hopName })`; `PacketGame` no longer has `hopName`.
  - CSS: a slotted mode panel carries `class="lan-panel"` and gets the base control styles from `LanSimulator.astro`; the To field is `<input class="dest">`; the packet strip colours any block whose layer is not `eth`, `ip`, `payload` or `trailer` with the request/reply colour.

- [ ] **Step 1: Branch**

```bash
git switch -c m8-stage2
```

(from `main` with this plan committed; if `git status` shows it uncommitted, commit it first: `docs(plan): Stage 2 Neighbor Discovery plan (R18)`).

- [ ] **Step 2: Write the new core tests** (they are tests of behaviour that already exists, so they pass at once; that is expected for this step, and the report should say so)

Append to `src/games/lan/sim.test.js`, inside `describe('createSim', …)`:

```js
  it('handles an empty queue: tick(0) moves nothing, runUntilIdle returns at once', () => {
    const state = { clock: 0, log: [] };
    let advanced = 0;
    const sim = createSim(state, { onAdvance: () => advanced++ });
    sim.tick(0);
    expect(state.clock).toBe(0);
    expect(advanced).toBe(1);
    sim.runUntilIdle();
    expect(state.clock).toBe(0);
    expect(advanced).toBe(1);
  });
```

Append to `src/games/lan/switch.test.js`, inside `describe('createSwitch', …)`:

```js
  it('never learns a multicast destination, only sources', () => {
    const { table, sw } = setup();
    sw.receive({ id: 1, src: MAC.H1, dst: '33:33:ff:00:00:12' }, 'Gi0/1');
    expect([...table.keys()]).toEqual([MAC.H1]);
  });
```

Append to `src/games/lan/lesson.test.js`, inside `describe('lesson playback', …)`:

```js
  it('a step without `until` never ends by itself, and playLesson stops when the engine runs dry', () => {
    const engine = tinyEngine();
    let fired = 0;
    const off = watchStep(engine, LESSON[0], () => fired++);
    engine.send('a');
    engine.runUntilIdle();
    off();
    expect(fired).toBe(0);
    // A step with no start and no `until`: nothing is queued, so playback returns at once.
    playLesson(engine, [LESSON[0], { title: 'x', caption: '', note: { node: 'H1', text: '' } }], 1);
    expect(engine.isIdle()).toBe(true);
  });
```

Run: `npx vitest run src/games/lan` — expected PASS.

- [ ] **Step 3: Small code fixes**
  1. `src/games/lan/sim.js`: the two stacked comments above `let queue = [];` become one:

```js
  /**
   * Timed actions, run in time order (then in the order they were added).
   * @type {{ at: number, seq: number, run: () => void }[]}
   */
```

  2. `src/games/lan/upstream.js`, in `forward`, on the line `const { ip, app = 'ping', reply = false } = frame;` add the comment above it: `// Like Python's app = frame.get('app', 'ping'): defaults for keys the frame lacks.`
  3. At the end of `src/games/lan/sim.js` add:

```js
/**
 * A device the shared view draws and the shared switch serves.
 * @typedef {{ name: string, role: 'host' | 'gateway' | 'attacker', mac: string, port: string, down: boolean }} LanHost
 */

/**
 * What the shared view and controller need from a game's engine (spec section 13). Packets
 * carry `ip: { src, dst, ttl }`; for IPv6, `ttl` holds the hop limit.
 * @typedef {object} LanEngine
 * @property {{ clock: number, hosts: Record<string, LanHost & Record<string, any>>,
 *   switch: { name: string, macTable: Map<string, { port: string, expiresAt: number }> },
 *   log: { at: number, text: string }[] }} state
 * @property {Sim['on']} on
 * @property {Sim['tick']} tick
 * @property {Sim['nextEventAt']} nextEventAt
 * @property {Sim['isIdle']} isIdle
 * @property {(src: string, dst: string, app?: 'ping' | 'web' | 'dns') => void} send
 */
```

  4. In `src/games/lan/renderer.js` type `engine` as `import('./sim.js').LanEngine` (in `mountLanRenderer`'s JSDoc), and in `src/games/lan/controller.js` make `LanGame.createEngine` return `import('./sim.js').LanEngine`.

- [ ] **Step 4: Renderer changes** (`src/games/lan/renderer.js`)
  1. `Layout` typedef: add `addrSize?: number` (document it: "font size in px for the address lines; the CSS size when unset"). In `drawTopology`, where the address lines are appended, keep each `svg('text', …)` in a const and, when `layout.addrSize` is set, set `text.style.fontSize = \`${layout.addrSize}px\`` (through `el.style`, as the MAC line does).
  2. `LanView` typedef: add

```js
 * @property {{ cache: (engine: import('./sim.js').LanEngine) => number, mac: (engine: import('./sim.js').LanEngine) => number }} lifetime
 *   The full length of a countdown, in ms, for the cache rows and the MAC-table rows. Read every frame,
 *   so a slider change shows at once.
```

  and extend the `cache` property's doc: "The engine's `cache:update`, `cache:stale` and `cache:expire` payloads are `{ host, ip }`; a row's `key` must equal that `ip`, so the changed row flashes."
  3. `row(cell, values, expiresAt, key)` gains a fifth parameter `table` (`'cache' | 'mac'`); when the countdown cell is built, also set `td.dataset.lifetime = table`. `drawCaches` passes `'cache'`, `drawMacTable` passes `'mac'`.
  4. In `update()`, replace `left / engine.state.ttlMs` with `left / game.lifetime[td.dataset.lifetime === 'mac' ? 'mac' : 'cache'](engine)`.
  5. In the subscriptions, add after `cache:expire`:

```js
    engine.on('cache:stale', ({ host, ip }) => {
      drawCaches();
      flash(/** @type {HTMLElement} */ (parts.caches.querySelector(`[data-host="${host}"]`)), ip);
    }),
    // A host's addresses changed (ND's Duplicate Address Detection): redraw its box and cache heading.
    engine.on('host:change', () => {
      drawTopology();
      drawCaches();
    }),
```

  6. `mountPacketView(parts.packet, { onFollow: …, game: game.packet })` gains `hopName: game.hopName,`.

- [ ] **Step 5: Packet view changes** (`src/games/lan/packet-view.js`)
  1. `PacketGame` typedef: remove `hopName`; add `@property {(frame: any) => string[]} [notes]  Short notes shown under the header rows, e.g. why a field has its value.`
  2. Signature: `@param {{ onFollow: () => void, game: PacketGame, hopName: string }} options` and `mountPacketView(panel, { onFollow, game, hopName })`; in `setHops` use `hopName` instead of `game.hopName`.
  3. In `show`, right after `body.append(zoomEl);`, add:

```js
    // 2b. The game's notes on this frame, if any (ND: why the hop limit is 255).
    const notes = game.notes?.(frame) ?? [];
    if (notes.length) {
      const list = html('ul', { class: 'packet-notes' });
      for (const text of notes) list.append(html('li', {}, text));
      body.append(list);
    }
```

- [ ] **Step 6: ARP's view config** (`src/games/arp/renderer.js`): add `lifetime: { cache: (engine) => engine.state.ttlMs, mac: (engine) => engine.state.ttlMs },` after `hopName: 'TTL',`, and delete `hopName: 'TTL',` from the `packet` object. (`engine` here is ARP's own engine, which has `state.ttlMs`; type the parameter `/** @param {any} engine */` if the editor complains.)

- [ ] **Step 7: CSS and markup** (`src/games/lan/LanSimulator.astro`, `src/pages/learn/arp.astro`)
  1. **Neutral layer colour.** Every selector `:global(.block.arp)` becomes `:global(.block:not(.eth, .ip, .payload, .trailer))` (same specificity: `:not()` counts as its most specific argument). Do the same for any other selector that names the `arp` layer (search the component for `.arp` and `zoom.arp`; leave `.lan` alone).
  2. **Prefix-free To field.** The To `<input>` gets `class="dest"`; the rule `#arp-dest { width: 10rem; }` becomes `.dest { width: 10rem; }`.
  3. **Slotted mode panels.** In the component's `<style>`, add the base control rules for slotted panels, each selector being the page copy's selector with `.lan-panel ` in front, wrapped in `:global(…)` so it carries no scope attribute (that keeps the specificity the page copy had), e.g.

```css
  /* Controls in a game's own mode panels: they are slotted in from the page, so the scoped rules
     above don't reach them. Same rules, same specificity. */
  :global(.lan-panel button),
  :global(.lan-panel select),
  :global(.lan-panel input) {
    font: inherit;
  }
```

  and so on for every rule in the page's copy (the block under the comment "The base control rules again" in `src/pages/learn/arp.astro`), including `[data-modes][hidden]` as `:global(.lan-panel[data-modes][hidden])`.
  4. In `src/pages/learn/arp.astro`: the slotted GARP section gets `class="garp lan-panel"`; delete the page's copy of the base control rules and its comment. Keep the page's `h2` copy (it serves the lesson-text heading, outside the simulator).

- [ ] **Step 8: Check, compare, commit**

```bash
npm run format && npm run check
```

Then rebuild, serve on 4329 and run the ARP visual test: 18 passed. If a shot differs, fix the change (most likely a CSS specificity or cascade-order difference), never the baseline.

```bash
git add -A src/games/lan src/games/arp/renderer.js src/pages/learn/arp.astro
git commit -m "refactor(lan): core adjustments for Neighbor Discovery: lifetimes, stale redraw, panel controls (R5, R18)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: IPv6 addresses (`nd/ipv6.js`)

**Files:**
- Create: `src/games/nd/ipv6.js`, `src/games/nd/ipv6.test.js`

**Interfaces:**
- Produces: `parseIpv6(text): Uint8Array | null`, `formatIpv6(bytes): string`, `normalize(text): string | null`, `solicitedNode(addr): string`, `multicastMac(addr): string`, `isLinkLocal(addr): boolean`, `isMulticast(addr): boolean`, `samePrefix64(a, b): boolean`, and the constants `UNSPECIFIED = '::'`, `ALL_NODES = 'ff02::1'`, `ALL_ROUTERS = 'ff02::2'`. Every `addr` argument is text in any valid form; every returned address is RFC 5952 text.

- [ ] **Step 1: Write the failing tests** `src/games/nd/ipv6.test.js`

```js
import { describe, expect, it } from 'vitest';
import {
  ALL_NODES,
  formatIpv6,
  isLinkLocal,
  isMulticast,
  multicastMac,
  normalize,
  parseIpv6,
  samePrefix64,
  solicitedNode,
} from './ipv6.js';

describe('parseIpv6', () => {
  it('reads the full form and the short form to the same 16 bytes', () => {
    const full = parseIpv6('2001:0db8:0000:0001:0000:0000:0000:0012');
    expect(full).toEqual(parseIpv6('2001:db8:0:1::12'));
    expect([...(full ?? [])]).toEqual([0x20, 0x01, 0x0d, 0xb8, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0x12]);
  });

  it('accepts ::, a trailing ::, and upper case', () => {
    expect([...(parseIpv6('::') ?? [])]).toEqual(Array(16).fill(0));
    expect(parseIpv6('fe80::')).not.toBe(null);
    expect(parseIpv6('2001:DB8::12')).toEqual(parseIpv6('2001:db8::12'));
  });

  it('rejects what is not an address', () => {
    for (const bad of ['', '192.0.2.1', '2001:db8', '1:2:3:4:5:6:7', '1:2:3:4:5:6:7:8:9', '1::2::3', ':1', '1:', '12345::', 'g::1', '1:2:3:4:5:6:7::8']) {
      expect(parseIpv6(bad), bad).toBe(null);
    }
  });
});

describe('formatIpv6 and normalize (RFC 5952)', () => {
  it('drops leading zeros, uses lower case, and shortens the longest run of zero groups', () => {
    expect(normalize('2001:0DB8:0000:0001:0000:0000:0000:0012')).toBe('2001:db8:0:1::12');
    expect(normalize('fe80:0:0:0:0:0:0:1')).toBe('fe80::1');
    expect(normalize('0:0:0:0:0:0:0:0')).toBe('::');
  });

  it('never shortens a single zero group, and picks the first of two equal runs', () => {
    expect(normalize('2001:db8:0:1:1:1:1:1')).toBe('2001:db8:0:1:1:1:1:1');
    expect(normalize('2001:db8:0:0:1:0:0:1')).toBe('2001:db8::1:0:0:1');
  });

  it('returns null for a bad address', () => {
    expect(normalize('nope')).toBe(null);
  });

  it('round-trips bytes', () => {
    expect(formatIpv6(/** @type {Uint8Array} */ (parseIpv6('ff02::1:ff00:12')))).toBe('ff02::1:ff00:12');
  });
});

describe('multicast groups', () => {
  it('builds the solicited-node group from the last 24 bits', () => {
    expect(solicitedNode('2001:db8:0:1::12')).toBe('ff02::1:ff00:12');
    expect(solicitedNode('fe80::12')).toBe('ff02::1:ff00:12');
    expect(solicitedNode('fe80::1')).toBe('ff02::1:ff00:1');
  });

  it('builds the multicast MAC from 33:33 and the last 32 bits', () => {
    expect(multicastMac('ff02::1:ff00:12')).toBe('33:33:ff:00:00:12');
    expect(multicastMac(ALL_NODES)).toBe('33:33:00:00:00:01');
    expect(multicastMac('ff02::2')).toBe('33:33:00:00:00:02');
  });
});

describe('address kinds', () => {
  it('knows link-local and multicast addresses', () => {
    expect(isLinkLocal('fe80::11')).toBe(true);
    expect(isLinkLocal('febf::1')).toBe(true);
    expect(isLinkLocal('ff02::1')).toBe(false);
    expect(isLinkLocal('2001:db8:0:1::11')).toBe(false);
    expect(isMulticast('ff02::1')).toBe(true);
    expect(isMulticast('2001:db8::1')).toBe(false);
  });

  it('compares the first 64 bits', () => {
    expect(samePrefix64('2001:db8:0:1::11', '2001:db8:0:1::')).toBe(true);
    expect(samePrefix64('2001:db8:0:1::11', '2001:db8:0:2::11')).toBe(false);
    expect(samePrefix64('2001:db8:8888::8', '2001:db8:0:1::')).toBe(false);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/games/nd/ipv6.test.js` — expected FAIL, unresolved import `./ipv6.js`.

- [ ] **Step 3: Write `src/games/nd/ipv6.js`**

```js
/**
 * IPv6 addresses for the Neighbor Discovery game (spec section 13, "Frames"). DOM-free.
 * Addresses travel as text in the RFC 5952 short form (2001:db8:0:1::12) everywhere
 * except on the wire, where frames.js turns them into 16 bytes.
 */

export const UNSPECIFIED = '::';
/** Every IPv6 device on the link listens to this group. */
export const ALL_NODES = 'ff02::1';
/** Routers also listen to this one. */
export const ALL_ROUTERS = 'ff02::2';

/**
 * Text to 16 bytes, from any valid form: full, with "::", any case. The dotted IPv4 tail
 * (::ffff:192.0.2.1) is not accepted; the game never needs it.
 * @param {string} text
 * @returns {Uint8Array | null}  null when the text isn't an IPv6 address.
 */
export function parseIpv6(text) {
  const s = text.trim().toLowerCase();
  if (!/^[0-9a-f:]+$/.test(s)) return null;
  const halves = s.split('::');
  if (halves.length > 2) return null;
  /** @param {string} part */
  const groups = (part) => (part === '' ? [] : part.split(':'));
  const head = groups(halves[0]);
  const tail = halves.length === 2 ? groups(halves[1]) : [];
  const missing = 8 - head.length - tail.length;
  // Without "::" there must be exactly 8 groups; "::" stands for at least one zero group.
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const all = [...head, ...Array(halves.length === 2 ? missing : 0).fill('0'), ...tail];
  if (all.some((group) => group.length === 0 || group.length > 4)) return null;
  const bytes = new Uint8Array(16);
  all.forEach((group, i) => {
    const n = parseInt(group, 16);
    bytes[2 * i] = n >> 8;
    bytes[2 * i + 1] = n & 0xff;
  });
  return bytes;
}

/**
 * 16 bytes to RFC 5952 text: lower case, no leading zeros, and the longest run of two or
 * more zero groups (the first, if two are equally long) written as "::".
 * @param {Uint8Array} bytes
 */
export function formatIpv6(bytes) {
  /** @type {number[]} */
  const groups = [];
  for (let i = 0; i < 16; i += 2) groups.push((bytes[i] << 8) | bytes[i + 1]);
  let best = { start: -1, length: 0 };
  for (let i = 0; i < 8; ) {
    if (groups[i] !== 0) {
      i++;
      continue;
    }
    let j = i;
    while (j < 8 && groups[j] === 0) j++;
    if (j - i > best.length) best = { start: i, length: j - i };
    i = j;
  }
  const hex = groups.map((group) => group.toString(16));
  if (best.length < 2) return hex.join(':');
  return `${hex.slice(0, best.start).join(':')}::${hex.slice(best.start + best.length).join(':')}`;
}

/**
 * Any valid form to RFC 5952 text, or null.
 * @param {string} text
 */
export function normalize(text) {
  const bytes = parseIpv6(text);
  return bytes ? formatIpv6(bytes) : null;
}

/** @param {string} addr */
function bytesOf(addr) {
  const bytes = parseIpv6(addr);
  if (!bytes) throw new Error(`Not an IPv6 address: ${addr}`);
  return bytes;
}

/**
 * The solicited-node group: ff02::1:ff plus the address's last 24 bits (RFC 4291 §2.7.1).
 * @param {string} addr
 */
export function solicitedNode(addr) {
  const out = new Uint8Array(16);
  out[0] = 0xff;
  out[1] = 0x02;
  out[11] = 0x01;
  out[12] = 0xff;
  out.set(bytesOf(addr).slice(13), 13);
  return formatIpv6(out);
}

/**
 * The Ethernet MAC for an IPv6 multicast address: 33:33 plus its last 32 bits (RFC 2464 §7).
 * @param {string} addr
 */
export function multicastMac(addr) {
  const last = [...bytesOf(addr).slice(12)];
  return ['33', '33', ...last.map((b) => b.toString(16).padStart(2, '0'))].join(':');
}

/** @param {string} addr  True for fe80::/10. */
export function isLinkLocal(addr) {
  const b = bytesOf(addr);
  return b[0] === 0xfe && (b[1] & 0xc0) === 0x80;
}

/** @param {string} addr  True for ff00::/8. */
export const isMulticast = (addr) => bytesOf(addr)[0] === 0xff;

/**
 * True when the first 64 bits match: the same subnet, for the /64s every LAN here uses.
 * @param {string} a
 * @param {string} b
 */
export function samePrefix64(a, b) {
  const x = bytesOf(a);
  const y = bytesOf(b);
  // Like Python's x[:8] == y[:8].
  return x.slice(0, 8).every((byte, i) => byte === y[i]);
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/games/nd/ipv6.test.js` — expected PASS.

- [ ] **Step 5: Check and commit**

```bash
npm run format && npm run check
git add src/games/nd/ipv6.js src/games/nd/ipv6.test.js
git commit -m "feat(nd): IPv6 addresses: RFC 5952 text, solicited-node groups, multicast MACs (R18)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Frames (`nd/frames.js`)

**Files:**
- Create: `src/games/nd/frames.js`, `src/games/nd/frames.test.js`

**Interfaces:**
- Consumes: `parseIpv6` (Task 2).
- Produces:
  - Constants `ETHERTYPE_IPV6 = 0x86dd`, `NEXT_HEADER_ICMPV6 = 58`, `ND_NS = 135`, `ND_NA = 136`, `ECHO_REQUEST = 128`, `ECHO_REPLY = 129`, `ECHO_ID = 1`.
  - The frame shape the engine builds (typedef `NdFrame`): `{ id, dst, src, type, ip: { src, dst, ttl }, nd?: { type: 135 | 136, target, lla?, router?, solicited?, override? }, app?: 'ping' | 'web' | 'dns', reply?: boolean, flow, parent? }`. `ip.ttl` is the hop limit. An echo's sequence number is its `flow`.
  - `appLabel(frame) → { short, long }`, `describeFrame(frame) → string`, `frameKind(frame) → 'request' | 'reply' | 'data'`, `frameLabel(frame) → string`, `icmpv6Checksum(src, dst, message: number[]) → number`, `encodeFrame(frame) → Uint8Array`, `frameFields(frame) → { name, value, offset, length }[]`, `breakdown(frame) → { strip, zoom }`, `frameNotes(frame) → string[]`.

The expected bytes below come from Scapy 2.6 (`uv run --no-project --with scapy python -I vectors.py`, run on 28 October 2026 with exactly these fields).

- [ ] **Step 1: Write the failing tests** `src/games/nd/frames.test.js`

```js
import { describe, expect, it } from 'vitest';
import {
  breakdown,
  describeFrame,
  encodeFrame,
  frameFields,
  frameKind,
  frameLabel,
  frameNotes,
  icmpv6Checksum,
} from './frames.js';

const H1 = '00:00:5e:00:53:11';
const H2 = '00:00:5e:00:53:12';
const H3 = '00:00:5e:00:53:13';
const G1 = '2001:db8:0:1::11';
const G2 = '2001:db8:0:1::12';
const G3 = '2001:db8:0:1::13';
const base = { id: 1, flow: 1, type: 0x86dd };

const FRAMES = {
  ns: { ...base, dst: '33:33:ff:00:00:12', src: H1, ip: { src: G1, dst: 'ff02::1:ff00:12', ttl: 255 }, nd: { type: 135, target: G2, lla: H1 } },
  na: {
    ...base,
    dst: H1,
    src: H2,
    ip: { src: G2, dst: G1, ttl: 255 },
    nd: { type: 136, target: G2, lla: H2, router: false, solicited: true, override: true },
  },
  dad: { ...base, dst: '33:33:ff:00:00:13', src: H3, ip: { src: '::', dst: 'ff02::1:ff00:13', ttl: 255 }, nd: { type: 135, target: G3 } },
  unsolicited: {
    ...base,
    dst: '33:33:00:00:00:01',
    src: H3,
    ip: { src: G2, dst: 'ff02::1', ttl: 255 },
    nd: { type: 136, target: G2, lla: H3, router: false, solicited: false, override: true },
  },
  echo: { ...base, dst: H2, src: H1, ip: { src: G1, dst: G2, ttl: 64 }, app: 'ping' },
  echoReply: { ...base, dst: H1, src: H2, ip: { src: G2, dst: G1, ttl: 64 }, app: 'ping', reply: true },
};

/** Scapy's bytes for the same frames (no FCS). */
const SCAPY = {
  ns: '3333ff00001200005e00531186dd6000000000203aff20010db8000000010000000000000011ff0200000000000000000001ff00001287006ce40000000020010db8000000010000000000000012010100005e005311',
  na: '00005e00531100005e00531286dd6000000000203aff20010db800000001000000000000001220010db80000000100000000000000118800db2d6000000020010db8000000010000000000000012020100005e005312',
  dad: '3333ff00001300005e00531386dd6000000000183aff00000000000000000000000000000000ff0200000000000000000001ff00001387004cc80000000020010db8000000010000000000000013',
  unsolicited: '33330000000100005e00531386dd6000000000203aff20010db8000000010000000000000012ff020000000000000000000000000001880049f42000000020010db8000000010000000000000012020100005e005313',
  echo: '00005e00531200005e00531186dd6000000000083a4020010db800000001000000000000001120010db80000000100000000000000128000242400010001',
  echoReply: '00005e00531100005e00531286dd6000000000083a4020010db800000001000000000000001220010db80000000100000000000000118100232400010001',
};

/** @param {Uint8Array} bytes */
const hex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');

describe('encodeFrame', () => {
  for (const name of /** @type {(keyof typeof FRAMES)[]} */ (Object.keys(FRAMES))) {
    it(`matches Scapy byte for byte: ${name}`, () => {
      expect(hex(encodeFrame(FRAMES[name]))).toBe(SCAPY[name]);
    });
  }

  it('sizes: 86 bytes for an NS or NA with its option, 78 for a DAD NS, 62 for a ping (no padding)', () => {
    expect(encodeFrame(FRAMES.ns)).toHaveLength(86);
    expect(encodeFrame(FRAMES.dad)).toHaveLength(78);
    expect(encodeFrame(FRAMES.echo)).toHaveLength(62);
  });

  it('carries only the Ethernet header for web and DNS, which are not decoded', () => {
    expect(encodeFrame({ ...FRAMES.echo, app: 'web' })).toHaveLength(14);
  });
});

describe('icmpv6Checksum', () => {
  it('is the one’s-complement sum over the pseudo-header and the message', () => {
    // The NS above with its checksum field zeroed: Scapy's checksum is 0x6ce4.
    const message = [
      0x87, 0, 0, 0, 0, 0, 0, 0,
      0x20, 0x01, 0x0d, 0xb8, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0x12,
      1, 1, 0, 0, 0x5e, 0, 0x53, 0x11,
    ];
    expect(icmpv6Checksum(G1, 'ff02::1:ff00:12', message)).toBe(0x6ce4);
  });
});

describe('frameFields', () => {
  it('covers every byte once, in order, and names the checksum', () => {
    const fields = frameFields(FRAMES.na);
    let offset = 0;
    for (const field of fields) {
      expect(field.offset).toBe(offset);
      offset += field.length;
    }
    expect(offset).toBe(86);
    expect(fields.find((f) => f.name === 'Checksum')?.value).toBe('0xdb2d');
    expect(fields.find((f) => f.name === 'Hop limit')?.value).toBe('255');
    expect(fields.find((f) => f.name === 'Flags')?.value).toBe('Router 0, Solicited 1, Override 1');
  });

  it('lists a web frame’s addresses without bytes, as the ARP game does', () => {
    const fields = frameFields({ ...FRAMES.echo, app: 'web' });
    expect(fields.map((f) => f.name)).toEqual([
      'Destination',
      'Source',
      'EtherType',
      'IPv6 source',
      'IPv6 destination',
      'Payload',
    ]);
  });
});

describe('labels', () => {
  it('describes each kind of frame in one line', () => {
    expect(describeFrame(FRAMES.ns)).toBe('Neighbor Solicitation: who has 2001:db8:0:1::12?');
    expect(describeFrame({ ...FRAMES.ns, dst: H2, ip: { ...FRAMES.ns.ip, dst: G2 } })).toBe(
      'Neighbor Solicitation (check): are you still 2001:db8:0:1::12?',
    );
    expect(describeFrame(FRAMES.dad)).toBe('Duplicate Address Detection: is anyone using 2001:db8:0:1::13?');
    expect(describeFrame(FRAMES.na)).toBe('Neighbor Advertisement: 2001:db8:0:1::12 is at 00:00:5e:00:53:12');
    expect(describeFrame(FRAMES.unsolicited)).toBe(
      'Unsolicited Neighbor Advertisement: 2001:db8:0:1::12 is at 00:00:5e:00:53:13',
    );
    expect(describeFrame(FRAMES.echo)).toBe('ping (ICMPv6 echo request): 2001:db8:0:1::11 → 2001:db8:0:1::12');
  });

  it('kinds and short labels', () => {
    expect([FRAMES.ns, FRAMES.na, FRAMES.echo].map(frameKind)).toEqual(['request', 'reply', 'data']);
    expect([FRAMES.ns, FRAMES.dad, FRAMES.na, FRAMES.echo, FRAMES.echoReply].map(frameLabel)).toEqual([
      'NS',
      'DAD',
      'NA',
      'ping',
      'echo',
    ]);
  });
});

describe('breakdown', () => {
  it('draws an NS as Ethernet, IPv6, ICMPv6 and FCS, and zooms into the solicitation', () => {
    const { strip, zoom } = breakdown(FRAMES.ns);
    expect(strip.map((b) => [b.label, b.bytes, b.layer])).toEqual([
      ['Destination MAC', 6, 'eth'],
      ['Source MAC', 6, 'eth'],
      ['Type', 2, 'eth'],
      ['IPv6 header', 40, 'ip'],
      ['ICMPv6 NS', 32, 'icmpv6'],
      ['FCS', 4, 'trailer'],
    ]);
    expect(zoom.title).toBe('Neighbor Solicitation (32 bytes)');
    expect(zoom.rows.map((row) => row.reduce((bits, cell) => bits + Math.min(cell.bits, 32), 0))).toEqual(
      Array(zoom.rows.length).fill(32),
    );
  });

  it('shows the NA flags as three 1-bit cells', () => {
    const { zoom } = breakdown(FRAMES.na);
    expect(zoom.rows[1].map((cell) => [cell.name, cell.value, cell.bits])).toEqual([
      ['R', '0', 1],
      ['S', '1', 1],
      ['O', '1', 1],
      ['Reserved', '0', 29],
    ]);
  });

  it('zooms into the IPv6 header for a ping', () => {
    const { strip, zoom } = breakdown(FRAMES.echo);
    expect(strip.map((b) => b.layer)).toEqual(['eth', 'eth', 'eth', 'ip', 'payload', 'trailer']);
    expect(zoom.title).toBe('IPv6 header (40 bytes)');
    expect(zoom.rows[1].map((cell) => cell.name)).toEqual(['Payload length', 'Next header', 'Hop limit']);
  });
});

describe('frameNotes', () => {
  it('explains the hop limit and a multicast MAC on ND frames, and nothing on a ping', () => {
    expect(frameNotes(FRAMES.ns)).toEqual([
      'Hop limit 255: a receiver drops Neighbor Discovery with any other value, so it can only come from this link.',
      'The destination MAC 33:33:ff:00:00:12 is made from the destination address ff02::1:ff00:12: 33:33 and its last 32 bits.',
    ]);
    expect(frameNotes(FRAMES.na)).toHaveLength(1);
    expect(frameNotes(FRAMES.echo)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/games/nd/frames.test.js` — expected FAIL, unresolved import `./frames.js`.

- [ ] **Step 3: Write `src/games/nd/frames.js`**

```js
/**
 * Frames for the IPv6 Neighbor Discovery game (spec section 13, "Frames"): the bytes on the
 * wire with a real ICMPv6 checksum, the field tree, the packet view's layouts and the labels.
 * DOM-free. Neighbor Solicitations and Advertisements (RFC 4861 §4.3, §4.4) and pings
 * (ICMPv6 echo, RFC 4443 §4.1) are encoded whole; web and DNS frames, like the ARP game's
 * data frames, only as far as their Ethernet header.
 */
import { parseIpv6 } from './ipv6.js';

export const ETHERTYPE_IPV6 = 0x86dd;
export const NEXT_HEADER_ICMPV6 = 58;
export const ND_NS = 135;
export const ND_NA = 136;
export const ECHO_REQUEST = 128;
export const ECHO_REPLY = 129;
/** The identifier every ping uses; its sequence number is the flow. */
export const ECHO_ID = 1;
/** Option types (RFC 4861 §4.6.1). */
const OPT_SOURCE_LLA = 1;
const OPT_TARGET_LLA = 2;

/**
 * @typedef {{ type: 135 | 136, target: string, lla?: string, router?: boolean, solicited?: boolean, override?: boolean }} NdMessage
 *   `lla` is the link-layer address option: the sender's MAC in an NS (none in a DAD NS), the target's in an NA.
 * @typedef {object} NdFrame
 * @property {number} id
 * @property {string} dst  Ethernet destination MAC.
 * @property {string} src  Ethernet source MAC.
 * @property {number} type  EtherType 0x86dd.
 * @property {{ src: string, dst: string, ttl: number }} ip  `ttl` holds the hop limit (the shared core's name for it).
 * @property {NdMessage} [nd]
 * @property {'ping' | 'web' | 'dns'} [app]
 * @property {boolean} [reply]
 * @property {number} flow  One per send; also a ping's sequence number.
 * @property {number} [parent]
 */

/** What each application's packet is, for labels and the inspector. */
const APP_PAYLOAD = /** @type {const} */ ({
  ping: { short: 'ping', long: 'ICMPv6 echo request' },
  web: { short: 'web', long: 'HTTP request over TCP' },
  dns: { short: 'DNS', long: 'DNS query over UDP' },
});
const APP_REPLY = /** @type {const} */ ({
  ping: { short: 'echo', long: 'ICMPv6 echo reply' },
  web: { short: 'page', long: 'HTTP response over TCP' },
  dns: { short: 'answer', long: 'DNS answer over UDP' },
});

/** @param {{ app?: 'ping' | 'web' | 'dns', reply?: boolean }} frame */
export function appLabel({ app = 'ping', reply = false }) {
  return (reply ? APP_REPLY : APP_PAYLOAD)[app];
}

/** @param {string} mac */
const macBytes = (mac) => mac.split(':').map((part) => parseInt(part, 16));
/** @param {number} n */
const u16 = (n) => [n >> 8, n & 0xff];
/** @param {number} n */
const u32 = (n) => [n >>> 24, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
/** @param {string} addr */
const ip6 = (addr) => [...(parseIpv6(addr) ?? new Uint8Array(16))];

/** True when the game encodes the whole frame: Neighbor Discovery or a ping. @param {NdFrame} frame */
const isIcmp = (frame) => Boolean(frame.nd) || (frame.app ?? 'ping') === 'ping';

/**
 * The ICMPv6 checksum (RFC 4443 §2.3): the one's-complement sum of the pseudo-header
 * (source, destination, length, next header 58) and the message with its checksum zeroed.
 * @param {string} src
 * @param {string} dst
 * @param {number[]} message
 */
export function icmpv6Checksum(src, dst, message) {
  const all = [...ip6(src), ...ip6(dst), ...u32(message.length), 0, 0, 0, NEXT_HEADER_ICMPV6, ...message];
  if (all.length % 2) all.push(0);
  let sum = 0;
  for (let i = 0; i < all.length; i += 2) sum += (all[i] << 8) | all[i + 1];
  // Fold the carries back in, like Python's while sum >> 16: sum = (sum & 0xffff) + (sum >> 16).
  while (sum > 0xffff) sum = (sum & 0xffff) + (sum >>> 16);
  return ~sum & 0xffff;
}

/**
 * The ICMPv6 message's fields, checksum still zero.
 * @param {NdFrame} frame
 * @returns {{ name: string, value: string, bytes: number[] }[]}
 */
function icmpFields(frame) {
  const { nd } = frame;
  if (!nd) {
    const type = frame.reply ? ECHO_REPLY : ECHO_REQUEST;
    return [
      { name: 'ICMPv6 type', value: `${type} (${frame.reply ? 'echo reply' : 'echo request'})`, bytes: [type] },
      { name: 'Code', value: '0', bytes: [0] },
      { name: 'Checksum', value: '', bytes: [0, 0] },
      { name: 'Identifier', value: String(ECHO_ID), bytes: u16(ECHO_ID) },
      { name: 'Sequence', value: String(frame.flow), bytes: u16(frame.flow) },
    ];
  }
  const ns = nd.type === ND_NS;
  const fields = [
    { name: 'ICMPv6 type', value: `${nd.type} (${ns ? 'Neighbor Solicitation' : 'Neighbor Advertisement'})`, bytes: [nd.type] },
    { name: 'Code', value: '0', bytes: [0] },
    { name: 'Checksum', value: '', bytes: [0, 0] },
  ];
  if (ns) {
    fields.push({ name: 'Reserved', value: '0', bytes: [0, 0, 0, 0] });
  } else {
    const flags = (nd.router ? 0x80 : 0) | (nd.solicited ? 0x40 : 0) | (nd.override ? 0x20 : 0);
    fields.push(
      {
        name: 'Flags',
        value: `Router ${nd.router ? 1 : 0}, Solicited ${nd.solicited ? 1 : 0}, Override ${nd.override ? 1 : 0}`,
        bytes: [flags],
      },
      { name: 'Reserved', value: '0', bytes: [0, 0, 0] },
    );
  }
  fields.push({ name: 'Target address', value: nd.target, bytes: ip6(nd.target) });
  if (nd.lla) {
    const type = ns ? OPT_SOURCE_LLA : OPT_TARGET_LLA;
    fields.push(
      { name: 'Option type', value: `${type} (${ns ? 'source' : 'target'} link-layer address)`, bytes: [type] },
      { name: 'Option length', value: '1 (8 bytes)', bytes: [1] },
      { name: ns ? 'Source link-layer address' : 'Target link-layer address', value: nd.lla, bytes: macBytes(nd.lla) },
    );
  }
  return fields;
}

/**
 * Every field in wire order, with its bytes. encodeFrame and frameFields both read this, so
 * the hex dump and the field tree cannot disagree.
 * @param {NdFrame} frame
 */
function layout(frame) {
  const fields = [
    {
      name: 'Destination',
      value: frame.dst.startsWith('33:33') ? `${frame.dst} (IPv6 multicast)` : frame.dst,
      bytes: macBytes(frame.dst),
    },
    { name: 'Source', value: frame.src, bytes: macBytes(frame.src) },
    { name: 'EtherType', value: 'IPv6 (0x86dd)', bytes: u16(ETHERTYPE_IPV6) },
  ];
  if (!isIcmp(frame)) return fields;
  const icmp = icmpFields(frame);
  const message = icmp.flatMap((field) => field.bytes); // like Python's [b for f in icmp for b in f.bytes]
  const sum = icmpv6Checksum(frame.ip.src, frame.ip.dst, message);
  const checksum = /** @type {(typeof icmp)[number]} */ (icmp.find((field) => field.name === 'Checksum'));
  checksum.bytes = u16(sum);
  checksum.value = `0x${sum.toString(16).padStart(4, '0')}`;
  fields.push(
    { name: 'Version, traffic class, flow label', value: '6, 0, 0', bytes: u32(0x60000000) },
    { name: 'Payload length', value: `${message.length} bytes`, bytes: u16(message.length) },
    { name: 'Next header', value: 'ICMPv6 (58)', bytes: [NEXT_HEADER_ICMPV6] },
    { name: 'Hop limit', value: String(frame.ip.ttl), bytes: [frame.ip.ttl] },
    { name: 'Source address', value: frame.ip.src, bytes: ip6(frame.ip.src) },
    { name: 'Destination address', value: frame.ip.dst, bytes: ip6(frame.ip.dst) },
    ...icmp,
  );
  return fields;
}

/**
 * The frame's bytes, without the FCS.
 * @param {NdFrame} frame
 */
export function encodeFrame(frame) {
  return Uint8Array.from(layout(frame).flatMap((field) => field.bytes));
}

/**
 * The packet view's field tree, with each field's place in encodeFrame's bytes. For web and
 * DNS, the IPv6 addresses and payload are listed with length 0: they are not decoded.
 * @param {NdFrame} frame
 * @returns {{ name: string, value: string, offset: number, length: number }[]}
 */
export function frameFields(frame) {
  let offset = 0;
  const fields = layout(frame).map(({ name, value, bytes }) => {
    const field = { name, value, offset, length: bytes.length };
    offset += bytes.length;
    return field;
  });
  if (isIcmp(frame)) return fields;
  return [
    ...fields,
    { name: 'IPv6 source', value: frame.ip.src, offset: 14, length: 0 },
    { name: 'IPv6 destination', value: frame.ip.dst, offset: 14, length: 0 },
    { name: 'Payload', value: `${appLabel(frame).long} (not decoded)`, offset: 14, length: 0 },
  ];
}

/**
 * One line describing a frame, for labels, the log and the packet view's heading.
 * @param {NdFrame} frame
 */
export function describeFrame(frame) {
  const { nd, ip } = frame;
  if (nd?.type === ND_NS) {
    if (ip.src === '::') return `Duplicate Address Detection: is anyone using ${nd.target}?`;
    if (ip.dst === nd.target) return `Neighbor Solicitation (check): are you still ${nd.target}?`;
    return `Neighbor Solicitation: who has ${nd.target}?`;
  }
  if (nd) return `${nd.solicited ? '' : 'Unsolicited '}Neighbor Advertisement: ${nd.target} is at ${nd.lla}`;
  const { short, long } = appLabel(frame);
  return `${short} (${long}): ${ip.src} → ${ip.dst}`;
}

/** @param {NdFrame} frame @returns {'request' | 'reply' | 'data'} */
export function frameKind(frame) {
  if (!frame.nd) return 'data';
  return frame.nd.type === ND_NS ? 'request' : 'reply';
}

/** The short label drawn on a moving frame. @param {NdFrame} frame */
export function frameLabel(frame) {
  if (!frame.nd) return appLabel(frame).short;
  if (frame.nd.type === ND_NA) return 'NA';
  return frame.ip.src === '::' ? 'DAD' : 'NS';
}

/**
 * Notes for the packet view: why an ND frame's hop limit is 255, and where a multicast MAC comes from.
 * @param {NdFrame} frame
 */
export function frameNotes(frame) {
  if (!frame.nd) return [];
  const notes = [
    'Hop limit 255: a receiver drops Neighbor Discovery with any other value, so it can only come from this link.',
  ];
  if (frame.dst.startsWith('33:33')) {
    notes.push(
      `The destination MAC ${frame.dst} is made from the destination address ${frame.ip.dst}: 33:33 and its last 32 bits.`,
    );
  }
  return notes;
}

/**
 * One block of the frame strip, and one cell of a 32-bit header row (as in the ARP game).
 * @typedef {{ label: string, value: string, bytes: number, layer: 'eth' | 'ip' | 'icmpv6' | 'payload' | 'trailer', field?: number }} StripBlock
 * @typedef {{ name: string, value: string, bits: number, field?: number, modelled?: boolean }} ZoomCell
 */

/**
 * The packet breakout: the whole frame as a strip of blocks, and one header in 32-bit rows,
 * the way RFCs draw it: the ND message for Neighbor Discovery, the IPv6 header otherwise.
 * @param {NdFrame} frame
 * @returns {{ strip: StripBlock[], zoom: { title: string, layer: 'ip' | 'icmpv6', rows: ZoomCell[][] } }}
 */
export function breakdown(frame) {
  const f = frameFields(frame);
  /** @param {number} i @param {number} bits @param {string} [name] @param {string} [value] */
  const cell = (i, bits, name = f[i].name, value = f[i].value) => ({ name, value, bits, field: i });
  /** @type {StripBlock[]} */
  const head = [
    { label: 'Destination MAC', value: frame.dst, bytes: 6, layer: 'eth', field: 0 },
    { label: 'Source MAC', value: frame.src, bytes: 6, layer: 'eth', field: 1 },
    { label: 'Type', value: '0x86dd', bytes: 2, layer: 'eth', field: 2 },
  ];
  /** @type {StripBlock} */
  const ipBlock = { label: 'IPv6 header', value: `${frame.ip.src} → ${frame.ip.dst}`, bytes: 40, layer: 'ip' };
  /** @type {StripBlock} */
  const fcs = { label: 'FCS', value: 'CRC-32', bytes: 4, layer: 'trailer' };

  if (!isIcmp(frame)) {
    /** @param {string} name @param {number} bits */
    const unmodelled = (name, bits) => ({ name, value: '·', bits, modelled: false });
    return {
      strip: [...head, ipBlock, { label: appLabel(frame).long, value: 'not decoded', bytes: 20, layer: 'payload' }, fcs],
      zoom: {
        title: 'IPv6 header (40 bytes)',
        layer: 'ip',
        rows: [
          [{ name: 'Ver.', value: '6', bits: 4 }, { name: 'Traffic class', value: '0', bits: 8 }, { name: 'Flow label', value: '0', bits: 20 }],
          [unmodelled('Payload length', 16), { name: 'Next header', value: frame.app === 'web' ? 'TCP (6)' : 'UDP (17)', bits: 8 }, { name: 'Hop limit', value: String(frame.ip.ttl), bits: 8 }],
          [{ name: 'Source address', value: frame.ip.src, bits: 128, field: 3 }],
          [{ name: 'Destination address', value: frame.ip.dst, bits: 128, field: 4 }],
        ],
      },
    };
  }

  const messageBytes = f.slice(9).reduce((n, field) => n + field.length, 0);
  if (!frame.nd) {
    return {
      strip: [...head, ipBlock, { label: appLabel(frame).long, value: `sequence ${frame.flow}`, bytes: messageBytes, layer: 'payload' }, fcs],
      zoom: {
        title: 'IPv6 header (40 bytes)',
        layer: 'ip',
        rows: [
          [cell(3, 4, 'Ver.', '6'), cell(3, 8, 'Traffic class', '0'), cell(3, 20, 'Flow label', '0')],
          [cell(4, 16), cell(5, 8), cell(6, 8)],
          [cell(7, 128)],
          [cell(8, 128)],
        ],
      },
    };
  }

  const { nd } = frame;
  const ns = nd.type === ND_NS;
  /** The link-layer option in two rows: 16 bits after its type and length, then the other 32. */
  const option = (first) =>
    nd.lla
      ? [
          [cell(first, 8, 'Option type'), cell(first + 1, 8, 'Length'), cell(first + 2, 16, 'Link-layer address', nd.lla.slice(0, 5))],
          [cell(first + 2, 32, 'Link-layer address (cont.)', nd.lla.slice(6))],
        ]
      : [];
  const rows = ns
    ? [[cell(9, 8, 'Type'), cell(10, 8), cell(11, 16)], [cell(12, 32)], [cell(13, 128)], ...option(14)]
    : [
        [cell(9, 8, 'Type'), cell(10, 8), cell(11, 16)],
        [
          cell(12, 1, 'R', nd.router ? '1' : '0'),
          cell(12, 1, 'S', nd.solicited ? '1' : '0'),
          cell(12, 1, 'O', nd.override ? '1' : '0'),
          cell(13, 29, 'Reserved', '0'),
        ],
        [cell(14, 128)],
        ...option(15),
      ];
  return {
    strip: [...head, ipBlock, { label: ns ? 'ICMPv6 NS' : 'ICMPv6 NA', value: nd.target, bytes: messageBytes, layer: 'icmpv6' }, fcs],
    zoom: { title: `${ns ? 'Neighbor Solicitation' : 'Neighbor Advertisement'} (${messageBytes} bytes)`, layer: 'icmpv6', rows },
  };
}
```

(Type the `option` helper's parameter: `/** @param {number} first */` above it.)

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/games/nd/frames.test.js` — expected PASS, the six Scapy vectors included. If a vector differs, compare byte by byte against the field list; do not change the expected hex.

- [ ] **Step 5: Check and commit**

```bash
npm run format && npm run check
git add src/games/nd/frames.js src/games/nd/frames.test.js
git commit -m "feat(nd): ND and echo frames with real ICMPv6 checksums, matching Scapy (R18)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Engine, part 1: Neighbor Discovery (`nd/engine.js`)

**Files:**
- Create: `src/games/nd/engine.js`, `src/games/nd/engine.test.js`

**Interfaces:**
- Consumes: `createSim`, `createSwitch`, `nicDrop`, `createUpstream` (shared core); Task 2's address helpers; Task 3's constants and `appLabel`.
- Produces:
  - `TOPOLOGY` (nodes H1, H2, H3, R1 with `name`, `role`, `global`, `linkLocal`, `mac`, `port`; `prefix: '2001:db8:0:1::'`; `upstream`), constants `DEFAULT_REACHABLE_MS = 30_000`, `MIN_REACHABLE_MS = 10_000`, `MAX_REACHABLE_MS = 300_000`, `MAC_AGE_MS = 60_000`, `HOP_MS = 600`, `RETRANS_MS = 1_000`, `ROUND_TRIP_MS = 4 * HOP_MS`, `MAX_SOLICIT = 3`, `HOP_LIMIT = 64`, `ND_HOP_LIMIT = 255`, `INTERNET_HOPS = 8`, `DEFAULT_ROUTER = 'fe80::1'`, and `checkNd(frame): null | 'hop limit not 255'`.
  - `createEngine({ reachableMs? })` → `{ state, on, emit, send, fail, primeCache, setReachableMs, tick, runUntilIdle, isIdle, nextEventAt }` (Task 5 adds `claimIp`, `takeOver`). `state.hosts[name]` has `global: string | null`, `tentative: string | null`, `duplicate: string | null`, `linkLocal`, `groups: Set<string>`, `neighbors: Map<string, { mac, state: 'REACHABLE' | 'STALE', reachableUntil?: number }>`, `pending`, `probing: Set<string>`, `down`. `state.reachableMs`.
  - Events: `frame:emit`, `frame:arrive`, `frame:drop`, `frame:forward`, `cache:update` `{ host, ip, mac, state, expiresAt? }`, `cache:stale` `{ host, ip }`, `cache:expire` `{ host, ip }`, `mactable:update`, `mactable:expire`, `nd:unreachable` `{ host, ip, time }`, `host:down`, `log` (Task 5 adds `dad:ok`, `dad:duplicate`, `host:change`).

**The timing rule.** Simulated hops are slow (600 ms each), so a round trip takes `ROUND_TRIP_MS` (4 hops) of simulated time. Real retransmission timers count from a moment when the answer would already be back, so every 1 s timer here is scheduled `ROUND_TRIP_MS + RETRANS_MS` after its frame is sent. The spec's "3 tries, 1 s apart" therefore show as 3.4 s apart in simulated time; the log says "a second apart", which is what a real host does.

- [ ] **Step 1: Write the failing tests** `src/games/nd/engine.test.js`

```js
import { describe, expect, it } from 'vitest';
import {
  checkNd,
  createEngine,
  HOP_MS,
  MAX_SOLICIT,
  RETRANS_MS,
  ROUND_TRIP_MS,
  TOPOLOGY,
} from './engine.js';

const MAC = Object.fromEntries(TOPOLOGY.nodes.map((n) => [n.name, n.mac])); // name -> MAC
const G1 = '2001:db8:0:1::11';
const G2 = '2001:db8:0:1::12';

/** @param {ReturnType<typeof createEngine>} engine */
function record(engine) {
  /** @type {{ event: string, payload: any }[]} */
  const seen = [];
  for (const event of [
    'frame:emit',
    'frame:arrive',
    'frame:drop',
    'frame:forward',
    'cache:update',
    'cache:stale',
    'cache:expire',
    'nd:unreachable',
    'log',
  ]) {
    engine.on(event, (payload) => seen.push({ event, payload }));
  }
  return {
    seen,
    /** @param {string} event */
    of: (event) => seen.filter((e) => e.event === event).map((e) => e.payload),
    /** Frames each device put on the wire (not SW1's copies). */
    sent: () => seen.filter((e) => e.event === 'frame:emit' && e.payload.from !== 'SW1').map((e) => e.payload),
    text: () => seen.filter((e) => e.event === 'log').map((e) => e.payload.text).join('\n'),
  };
}

describe('topology and groups', () => {
  it('builds the section 13 LAN, each card joined to all-nodes and its solicited-node group', () => {
    const { state } = createEngine();
    expect(Object.keys(state.hosts)).toEqual(['H1', 'H2', 'H3', 'R1']);
    expect(state.hosts.H2).toMatchObject({ global: G2, linkLocal: 'fe80::12', mac: MAC.H2, port: 'Gi0/2' });
    expect([...state.hosts.H2.groups].sort()).toEqual(['33:33:00:00:00:01', '33:33:ff:00:00:12']);
    expect([...state.hosts.R1.groups].sort()).toEqual(['33:33:00:00:00:01', '33:33:00:00:00:02', '33:33:ff:00:00:01']);
  });
});

describe('resolving a neighbour', () => {
  it('sends a Neighbor Solicitation to the solicited-node group, with hop limit 255 and its MAC', () => {
    const engine = createEngine();
    const r = record(engine);
    engine.send('H1', G2);
    const [first] = r.sent();
    expect(first.frame).toMatchObject({
      dst: '33:33:ff:00:00:12',
      src: MAC.H1,
      ip: { src: G1, dst: 'ff02::1:ff00:12', ttl: 255 },
      nd: { type: 135, target: G2, lla: MAC.H1 },
    });
    expect(r.text()).toMatch(/knows only the IPv6 address, but Ethernet delivers frames by MAC address/);
  });

  it('accepts any spelling of the address', () => {
    const engine = createEngine();
    const r = record(engine);
    engine.send('H1', '2001:DB8:0:1:0:0:0:12');
    expect(r.sent()[0].frame.nd.target).toBe(G2);
  });

  it('is flooded by SW1 and dropped by the cards of H3 and R1, not their software', () => {
    const engine = createEngine();
    const r = record(engine);
    engine.send('H1', G2);
    engine.tick(2 * HOP_MS);
    expect(r.of('frame:drop').map((d) => [d.node, d.reason])).toEqual([
      ['H3', 'not my group (network card)'],
      ['R1', 'not my group (network card)'],
    ]);
  });

  it('the target caches the asker as STALE and answers with a unicast NA (S=1, O=1)', () => {
    const engine = createEngine();
    const r = record(engine);
    engine.send('H1', G2);
    engine.tick(2 * HOP_MS);
    expect(engine.state.hosts.H2.neighbors.get(G1)).toEqual({ mac: MAC.H1, state: 'STALE' });
    const na = r.sent().find((hop) => hop.from === 'H2')?.frame;
    expect(na).toMatchObject({
      dst: MAC.H1,
      ip: { src: G2, dst: G1, ttl: 255 },
      nd: { type: 136, target: G2, lla: MAC.H2, router: false, solicited: true, override: true },
    });
  });

  it('the asker caches the answer as REACHABLE and sends the waiting ping', () => {
    const engine = createEngine();
    const r = record(engine);
    engine.send('H1', G2);
    engine.tick(4 * HOP_MS);
    expect(engine.state.hosts.H1.neighbors.get(G2)).toEqual({
      mac: MAC.H2,
      state: 'REACHABLE',
      reachableUntil: 4 * HOP_MS + engine.state.reachableMs,
    });
    expect(r.sent().at(-1)?.frame).toMatchObject({ dst: MAC.H2, ip: { src: G1, dst: G2, ttl: 64 }, app: 'ping' });
  });

  it('a STALE entry sends at once, then checks with a unicast NS; the answer makes it REACHABLE', () => {
    const engine = createEngine();
    const r = record(engine);
    engine.send('H1', G2);
    engine.runUntilIdle();
    const fromH2 = r.sent().filter((hop) => hop.from === 'H2').map((hop) => hop.frame);
    const reply = fromH2.findIndex((f) => f.reply);
    const check = fromH2.findIndex((f) => f.nd?.type === 135);
    expect(reply).toBeGreaterThan(-1);
    expect(check).toBe(reply + 1);
    expect(fromH2[check]).toMatchObject({ dst: MAC.H1, ip: { src: G2, dst: G1, ttl: 255 }, nd: { target: G1, lla: MAC.H2 } });
    expect(engine.state.hosts.H2.neighbors.get(G1)?.state).toBe('REACHABLE');
    expect(r.text()).toMatch(/H1 receives the ICMPv6 echo reply from 2001:db8:0:1::12/);
    expect(r.text()).toMatch(/Real hosts wait 5 seconds first/);
  });

  it('a second ping while REACHABLE uses no Neighbor Discovery at all', () => {
    const engine = createEngine();
    const r = record(engine);
    engine.send('H1', G2);
    engine.runUntilIdle();
    const before = r.sent().length;
    engine.send('H1', G2);
    engine.runUntilIdle();
    expect(r.sent().slice(before).filter((hop) => hop.frame.nd)).toEqual([]);
    expect(r.text()).toMatch(/already has 2001:db8:0:1::12 in its neighbor cache \(00:00:5e:00:53:12, REACHABLE\)/);
  });

  it('turns REACHABLE into STALE after the reachable time, and the next send checks', () => {
    const engine = createEngine({ reachableMs: 10_000 });
    const r = record(engine);
    engine.send('H1', G2);
    engine.runUntilIdle();
    engine.tick(10_000);
    expect(r.of('cache:stale')).toContainEqual({ host: 'H1', ip: G2 });
    expect(engine.state.hosts.H1.neighbors.get(G2)?.state).toBe('STALE');
    const before = r.sent().length;
    engine.send('H1', G2);
    expect(r.sent().slice(before).map((hop) => (hop.frame.nd ? 'NS' : 'ping'))).toEqual(['ping', 'NS']);
  });

  it('an unused address gets three solicitations, then "address unreachable"', () => {
    const engine = createEngine();
    const r = record(engine);
    engine.send('H1', '2001:db8:0:1::99');
    engine.runUntilIdle();
    expect(r.sent().filter((hop) => hop.frame.nd?.type === 135)).toHaveLength(MAX_SOLICIT);
    expect(r.of('nd:unreachable')).toEqual([
      { host: 'H1', ip: '2001:db8:0:1::99', time: MAX_SOLICIT * (ROUND_TRIP_MS + RETRANS_MS) },
    ]);
    expect(r.text()).toMatch(/address unreachable" \(ICMPv6 type 1, code 3\)/);
  });

  it('a link-local destination is asked for from the link-local address', () => {
    const engine = createEngine();
    const r = record(engine);
    engine.send('H1', 'fe80::12');
    expect(r.sent()[0].frame).toMatchObject({ ip: { src: 'fe80::11', dst: 'ff02::1:ff00:12' }, nd: { target: 'fe80::12' } });
    engine.runUntilIdle();
    expect(r.text()).toMatch(/H1 receives the ICMPv6 echo reply from fe80::12/);
  });

  it('sending to its own address puts nothing on the wire', () => {
    const engine = createEngine();
    const r = record(engine);
    engine.send('H1', G1);
    expect(r.sent()).toEqual([]);
    expect(r.text()).toMatch(/own address/);
  });
});

describe('off the link, through R1', () => {
  it('asks for fe80::1 from its global address, sends the packet to R1, and the answer comes back', () => {
    const engine = createEngine();
    const r = record(engine);
    engine.send('H1', '2001:db8:8888::8');
    expect(r.sent()[0].frame).toMatchObject({
      dst: '33:33:ff:00:00:01',
      ip: { src: G1, dst: 'ff02::1:ff00:1' },
      nd: { target: 'fe80::1' },
    });
    expect(r.text()).toMatch(/default router, R1 \(fe80::1\)/);
    engine.runUntilIdle();
    const na = r.sent().find((hop) => hop.from === 'R1' && hop.frame.nd)?.frame;
    expect(na.nd).toMatchObject({ target: 'fe80::1', router: true, solicited: true });
    const ping = r.sent().find((hop) => hop.from === 'H1' && hop.frame.app === 'ping')?.frame;
    expect(ping).toMatchObject({ dst: MAC.R1, ip: { src: G1, dst: '2001:db8:8888::8', ttl: 64 } });
    const out = r.of('frame:forward').find((f) => f.to === 'next hop')?.out;
    expect(out).toMatchObject({ src: TOPOLOGY.upstream.mac, ip: { ttl: 63 } });
    expect(r.text()).toMatch(/lowers the Hop limit from 64 to 63/);
    expect(r.text()).toMatch(/H1 receives the ICMPv6 echo reply from 2001:db8:8888::8/);
  });
});

describe('rules and settings', () => {
  it('accepts Neighbor Discovery only with hop limit 255', () => {
    expect(checkNd({ ip: { ttl: 255 } })).toBe(null);
    expect(checkNd({ ip: { ttl: 64 } })).toBe('hop limit not 255');
  });

  it('keeps the reachable time within 10–300 s', () => {
    const engine = createEngine();
    engine.setReachableMs(1);
    expect(engine.state.reachableMs).toBe(10_000);
    engine.setReachableMs(1e9);
    expect(engine.state.reachableMs).toBe(300_000);
  });

  it('primes a cache entry from the topology, REACHABLE', () => {
    const engine = createEngine();
    engine.primeCache('H1', G2);
    expect(engine.state.hosts.H1.neighbors.get(G2)).toMatchObject({ mac: MAC.H2, state: 'REACHABLE' });
  });

  it('a failed host sends nothing and gets nothing', () => {
    const engine = createEngine();
    const r = record(engine);
    engine.fail('H2');
    engine.send('H2', G1);
    expect(r.sent()).toEqual([]);
    engine.send('H1', G2);
    engine.runUntilIdle();
    expect(r.of('nd:unreachable')).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/games/nd/engine.test.js` — expected FAIL, unresolved import `./engine.js`.

- [ ] **Step 3: Write `src/games/nd/engine.js`**

```js
/**
 * IPv6 Neighbor Discovery simulation engine (spec section 13). DOM-free: no window, no document.
 * Built on the shared LAN core (src/games/lan/): the clock, SW1, the network cards and R1's
 * upstream link are the ARP game's; this file adds Neighbor Discovery (RFC 4861) and, in
 * Task 5, Duplicate Address Detection (RFC 4862).
 *
 * Time is simulated and kept by the shared core: every hop takes HOP_MS, and tick(ms) runs
 * whatever falls due, in order, so tests run a whole exchange instantly.
 */
import { createSim } from '../lan/sim.js';
import { createSwitch } from '../lan/switch.js';
import { nicDrop } from '../lan/nic.js';
import { createUpstream } from '../lan/upstream.js';
import { ETHERTYPE_IPV6, ND_NA, ND_NS } from './frames.js';
import { ALL_NODES, ALL_ROUTERS, isLinkLocal, multicastMac, normalize, samePrefix64, solicitedNode } from './ipv6.js';

/**
 * @typedef {'ping' | 'web' | 'dns'} App
 * @typedef {import('./frames.js').NdFrame} Frame
 * @typedef {{ mac: string, state: 'REACHABLE' | 'STALE', reachableUntil?: number }} Neighbor
 * @typedef {{ ip: { src: string, dst: string, ttl: number }, app: App, reply: boolean, flow: number, via?: Frame }} Packet
 */

/** The same LAN as the ARP game (section 6), in IPv6. MACs from the RFC 7042 documentation range. */
export const TOPOLOGY = /** @type {const} */ ({
  switch: { name: 'SW1' },
  /** The link's /64: every global address here starts with it. */
  prefix: '2001:db8:0:1::',
  nodes: [
    { name: 'H1', role: 'host', global: '2001:db8:0:1::11', linkLocal: 'fe80::11', mac: '00:00:5e:00:53:11', port: 'Gi0/1' },
    { name: 'H2', role: 'host', global: '2001:db8:0:1::12', linkLocal: 'fe80::12', mac: '00:00:5e:00:53:12', port: 'Gi0/2' },
    { name: 'H3', role: 'host', global: '2001:db8:0:1::13', linkLocal: 'fe80::13', mac: '00:00:5e:00:53:13', port: 'Gi0/3' },
    { name: 'R1', role: 'gateway', global: '2001:db8:0:1::1', linkLocal: 'fe80::1', mac: '00:00:5e:00:53:01', port: 'Gi0/4' },
  ],
  // R1's other interface, toward the internet, and the router at the far end of that link,
  // which R1 already knows: the game doesn't simulate Neighbor Discovery on that link.
  upstream: {
    ip: '2001:db8:0:ff::1',
    mac: '00:00:5e:00:53:a1',
    nextHop: { name: 'next hop', ip: 'fe80::fe', mac: '00:00:5e:00:53:fe' },
  },
});

/** How long an answered neighbour stays REACHABLE (RFC 4861's ReachableTime is 15–45 s, about 30). */
export const DEFAULT_REACHABLE_MS = 30_000;
export const MIN_REACHABLE_MS = 10_000;
export const MAX_REACHABLE_MS = 300_000;
/** SW1's MAC table ageing, as in the ARP game's default. */
export const MAC_AGE_MS = 60_000;
/** Simulated time for a frame to cross one link. */
export const HOP_MS = 600;
/** RFC 4861's RetransTimer: the wait between solicitations, and DAD's wait for a defence. */
export const RETRANS_MS = 1_000;
/** A request and its answer cross four links: the timers start counting after that. */
export const ROUND_TRIP_MS = 4 * HOP_MS;
/** MAX_MULTICAST_SOLICIT and MAX_UNICAST_SOLICIT. */
export const MAX_SOLICIT = 3;
/** The hop limit a host puts on a new packet; each router lowers it by one. */
export const HOP_LIMIT = 64;
/** Neighbor Discovery is always sent with 255 and must arrive with 255 (RFC 4861 §7.1). */
export const ND_HOP_LIMIT = 255;
/** Routers an answer from the internet is taken to have crossed before the next hop (illustrative). */
export const INTERNET_HOPS = 8;
/** Real hosts learn this from R1's Router Advertisements; the game gives it to them. */
export const DEFAULT_ROUTER = 'fe80::1';

const SWITCH = TOPOLOGY.switch.name;
const ALL_NODES_MAC = multicastMac(ALL_NODES);
const ALL_ROUTERS_MAC = multicastMac(ALL_ROUTERS);

/** @type {Record<App, string>} */
const APP_LABEL = { ping: 'a ping (ICMPv6 echo request)', web: 'a web request (HTTP over TCP)', dns: 'a DNS query (UDP)' };
/** @type {Record<App, string>} */
const REPLY_LABEL = { ping: 'the ICMPv6 echo reply', web: 'the web response', dns: 'the DNS answer' };
/** @param {{ app?: App, reply?: boolean }} packet */
const labelOf = ({ app = 'ping', reply }) => (reply ? REPLY_LABEL[app] : APP_LABEL[app]);

/**
 * Why a host would refuse a Neighbor Discovery frame, or null when it accepts it: only hop
 * limit 255 proves the frame was sent on this link, not routed in from elsewhere.
 * @param {{ ip: { ttl: number } }} frame
 */
export function checkNd(frame) {
  return frame.ip.ttl === ND_HOP_LIMIT ? null : 'hop limit not 255';
}

/**
 * Create a fresh simulation. To reset, create a new one.
 * @param {{ reachableMs?: number }} [options]
 */
export function createEngine({ reachableMs = DEFAULT_REACHABLE_MS } = {}) {
  const state = {
    clock: 0,
    reachableMs,
    hosts: Object.fromEntries(
      TOPOLOGY.nodes.map((node) => [
        node.name,
        {
          ...node,
          /** @type {string | null} The usable global address; null during DAD, or after DAD failed. */
          global: /** @type {string | null} */ (node.global),
          /** @type {string | null} An address DAD is still checking, not yet usable. */
          tentative: /** @type {string | null} */ (null),
          /** @type {string | null} An address DAD found in use by another device. */
          duplicate: /** @type {string | null} */ (null),
          /** @type {Set<string>} Multicast MACs the network card listens to. */
          groups: new Set(),
          /** @type {Map<string, Neighbor>} The neighbour cache: address -> entry, like a dict of dicts. */
          neighbors: new Map(),
          /** @type {Map<string, Packet[]>} Addresses being asked for, and the packets waiting for the answer. */
          pending: new Map(),
          /** @type {Set<string>} Neighbours being checked with a unicast solicitation. */
          probing: new Set(),
          down: false,
        },
      ]),
    ),
    switch: {
      name: SWITCH,
      /** @type {Map<string, { port: string, expiresAt: number }>} */
      macTable: new Map(),
    },
    /** @type {{ at: number, text: string }[]} */
    log: [],
  };
  /** @typedef {(typeof state.hosts)[string]} Host */

  // The clock, timed actions, events and log are shared with the other LAN games.
  const sim = createSim(state, { onAdvance: expire });
  const { on, emit, log, schedule } = sim;
  const sw = createSwitch(sim, {
    name: SWITCH,
    table: state.switch.macTable,
    devices: () => Object.values(state.hosts),
    ttlMs: () => MAC_AGE_MS,
    hopMs: HOP_MS,
    deliver: hostReceive,
  });
  const uplink = createUpstream(sim, {
    link: TOPOLOGY.upstream,
    etherType: ETHERTYPE_IPV6,
    hopName: 'Hop limit',
    ipTtl: HOP_LIMIT,
    internetHops: INTERNET_HOPS,
    hopMs: HOP_MS,
    labelOf,
    onLan: fromUpstream,
  });
  for (const host of Object.values(state.hosts)) joinGroups(host);

  /** @param {string} name */
  function hostNamed(name) {
    const host = state.hosts[name];
    if (!host) throw new Error(`No host named ${name}`);
    return host;
  }

  /**
   * The groups a card listens to: all nodes, all routers on R1, and the solicited-node group
   * of each of its addresses (a tentative one too, so DAD hears a defence).
   * @param {Host} host
   */
  function joinGroups(host) {
    const addresses = [host.global, host.linkLocal, host.tentative].filter((a) => a !== null);
    host.groups = new Set([
      ALL_NODES_MAC,
      ...(host.role === 'gateway' ? [ALL_ROUTERS_MAC] : []),
      ...addresses.map((addr) => multicastMac(solicitedNode(addr))),
    ]);
  }

  /** @param {Host} host @param {string} addr */
  const owns = (host, addr) => addr === host.global || addr === host.linkLocal;
  /** @param {string} addr  On this link: link-local, or inside the link's /64. */
  const onLink = (addr) => isLinkLocal(addr) || samePrefix64(addr, TOPOLOGY.prefix);
  /** @param {Host} host @param {string} dst  The source address to use toward `dst`. */
  const sourceFor = (host, dst) => (isLinkLocal(dst) || host.global === null ? host.linkLocal : host.global);
  /** @param {string} dst */
  const nextHopFor = (dst) => (onLink(dst) ? dst : DEFAULT_ROUTER);
  /** @param {string} mac */
  const nameOfMac = (mac) => Object.values(state.hosts).find((h) => h.mac === mac)?.name ?? mac;

  /**
   * Put a new frame on a host's link toward the switch.
   * @param {Host} host
   * @param {Omit<Frame, 'id'>} fields
   */
  function transmit(host, fields) {
    return transmitFrame(host, /** @type {Frame} */ ({ id: sim.frameId(), ...fields }));
  }

  /** @param {Host} host @param {Frame} frame */
  function transmitFrame(host, frame) {
    emit('frame:emit', { frame, from: host.name, to: SWITCH, at: state.clock, arrivesAt: state.clock + HOP_MS });
    schedule(HOP_MS, () => sw.receive(frame, host.port));
    return frame;
  }

  /** @param {Host} host @param {Frame} frame @param {string} reason */
  function drop(host, frame, reason) {
    emit('frame:drop', { frame, node: host.name, reason, time: state.clock });
  }

  /** @param {Host} host @param {Frame} frame */
  function hostReceive(host, frame) {
    emit('frame:arrive', { frame, node: host.name, time: state.clock });
    if (host.down) return;
    const reason = nicDrop(host, frame.dst);
    if (reason) return drop(host, frame, reason);
    if (frame.nd) {
      const refused = checkNd(frame);
      if (refused) return drop(host, frame, refused);
      return frame.nd.type === ND_NS ? receiveSolicitation(host, frame) : receiveAdvertisement(host, frame);
    }
    receiveData(host, frame);
  }

  /**
   * Add or change a neighbour cache entry.
   * @param {Host} host
   * @param {string} addr
   * @param {string} mac
   * @param {'REACHABLE' | 'STALE'} entryState
   */
  function setNeighbor(host, addr, mac, entryState) {
    /** @type {Neighbor} */
    const entry =
      entryState === 'REACHABLE'
        ? { mac, state: entryState, reachableUntil: state.clock + state.reachableMs }
        : { mac, state: entryState };
    host.neighbors.set(addr, entry);
    emit('cache:update', { host: host.name, ip: addr, mac, state: entryState, expiresAt: entry.reachableUntil });
  }

  /**
   * A Neighbor Solicitation for one of the host's addresses: note the asker, answer it.
   * @param {Host} host
   * @param {Frame} frame
   */
  function receiveSolicitation(host, frame) {
    const nd = /** @type {import('./frames.js').NdMessage} */ (frame.nd);
    const { ip } = frame;
    if (!owns(host, nd.target)) return drop(host, frame, 'not my address');
    const check = ip.dst === nd.target; // unicast to the address itself: a reachability check
    if (nd.lla) {
      const had = host.neighbors.get(ip.src);
      // RFC 4861 §7.2.3: a new or changed MAC is STALE; the same MAC keeps its state.
      if (!had || had.mac !== nd.lla) setNeighbor(host, ip.src, nd.lla, 'STALE');
    }
    log(
      check
        ? `${host.name} answers ${ip.src}'s check: ${nd.target} is still here, at ${host.mac}.`
        : `${host.name} has ${nd.target}. It notes that ${ip.src} is at ${nd.lla} as STALE (a solicitation proves nothing about the way back) and answers straight to ${ip.src}.`,
    );
    transmit(host, {
      dst: nd.lla ?? frame.src,
      src: host.mac,
      type: ETHERTYPE_IPV6,
      ip: { src: nd.target, dst: ip.src, ttl: ND_HOP_LIMIT },
      nd: { type: ND_NA, target: nd.target, lla: host.mac, router: host.role === 'gateway', solicited: true, override: true },
      flow: frame.flow,
    });
  }

  /**
   * A Neighbor Advertisement: the answer the host was waiting for, or one it didn't ask for.
   * @param {Host} host
   * @param {Frame} frame
   */
  function receiveAdvertisement(host, frame) {
    const nd = /** @type {import('./frames.js').NdMessage} */ (frame.nd);
    const lla = /** @type {string} */ (nd.lla);
    const asked = host.pending.has(nd.target) || host.probing.has(nd.target);
    // RFC 4861 §7.2.5: an answer to a question nobody asked changes nothing.
    if (!asked) return drop(host, frame, 'not asked');
    setNeighbor(host, nd.target, lla, 'REACHABLE');
    if (host.probing.delete(nd.target)) {
      log(`${host.name}'s check is answered: ${nd.target} is REACHABLE again.`);
    } else {
      log(`${host.name} learns that ${nd.target} is at ${lla}: REACHABLE, because this answer proves the way back works too.`);
    }
    const waiting = host.pending.get(nd.target) ?? [];
    host.pending.delete(nd.target);
    for (const packet of waiting) sendData(host, lla, packet);
  }

  /** @param {Host} host @param {Frame} frame */
  function receiveData(host, frame) {
    const { ip, reply = false } = frame;
    if (owns(host, ip.dst)) {
      log(`${host.name} receives ${labelOf(frame)} from ${ip.src}.`);
      if (!reply) answer(host, frame);
    } else if (host.role === 'gateway' && !onLink(ip.dst)) {
      uplink.forward(host, /** @type {any} */ (frame));
    } else {
      drop(host, frame, 'not for me');
    }
  }

  /**
   * The destination answers: an echo reply, a web response or a DNS answer, from the
   * address the request was sent to.
   * @param {Host} host
   * @param {Frame} request
   */
  function answer(host, request) {
    /** @type {Packet} */
    const packet = {
      ip: { src: request.ip.dst, dst: request.ip.src, ttl: HOP_LIMIT },
      app: request.app ?? 'ping',
      reply: true,
      flow: request.flow,
    };
    deliver(host, nextHopFor(request.ip.src), packet);
  }

  /**
   * Send a packet to `nextHop` on the link: at once with a cache entry (checking a STALE one
   * afterwards), otherwise after Neighbor Discovery.
   * @param {Host} host
   * @param {string} nextHop
   * @param {Packet} packet
   */
  function deliver(host, nextHop, packet) {
    const entry = host.neighbors.get(nextHop);
    if (entry) {
      const stale = entry.state === 'STALE';
      if (stale) {
        log(
          `${host.name} has ${nextHop} in its neighbor cache, but STALE: it sends the packet to ${entry.mac} at once, then checks the neighbor is still there. (Real hosts wait 5 seconds first: the DELAY state.)`,
        );
      }
      sendData(host, entry.mac, packet);
      if (stale && !host.probing.has(nextHop)) check(host, nextHop, entry.mac, packet.flow);
      return;
    }
    const waiting = host.pending.get(nextHop);
    if (waiting) {
      waiting.push(packet);
      log(`${host.name} is already asking for ${nextHop}; this packet waits for the same answer.`);
      return;
    }
    host.pending.set(nextHop, [packet]);
    solicit(host, nextHop, packet.ip.src, packet.flow, 1);
  }

  /**
   * Ask the target's solicited-node group for its MAC; ask again a second later, up to 3 times.
   * @param {Host} host
   * @param {string} target
   * @param {string} src  The address the waiting packet uses (RFC 4861 §7.2.2).
   * @param {number} flow
   * @param {number} attempt
   */
  function solicit(host, target, src, flow, attempt) {
    const group = solicitedNode(target);
    transmit(host, {
      dst: multicastMac(group),
      src: host.mac,
      type: ETHERTYPE_IPV6,
      ip: { src, dst: group, ttl: ND_HOP_LIMIT },
      nd: { type: ND_NS, target, lla: host.mac },
      flow,
    });
    log(
      attempt === 1
        ? `${host.name} sends a Neighbor Solicitation to ${target}'s solicited-node group, ${group} (${multicastMac(group)}): who has ${target}? Its own MAC rides along, so the answer can come straight back.`
        : `No answer yet: ${host.name} asks for ${target} again (try ${attempt} of ${MAX_SOLICIT}).`,
    );
    schedule(ROUND_TRIP_MS + RETRANS_MS, () => {
      if (!host.pending.has(target)) return;
      if (attempt < MAX_SOLICIT) return solicit(host, target, src, flow, attempt + 1);
      const dropped = host.pending.get(target)?.length ?? 0;
      host.pending.delete(target);
      emit('nd:unreachable', { host: host.name, ip: target, time: state.clock });
      log(
        `No answer for ${target} after ${MAX_SOLICIT} Neighbor Solicitations, a second apart. ${host.name} gives up: ${dropped === 1 ? 'the waiting packet is' : `${dropped} waiting packets are`} dropped, and the application gets "address unreachable" (ICMPv6 type 1, code 3).`,
      );
    });
  }

  /**
   * Check a STALE neighbour with a solicitation sent straight to it; delete the entry after
   * 3 unanswered checks.
   * @param {Host} host
   * @param {string} target
   * @param {string} mac
   * @param {number} flow
   * @param {number} [attempt]
   */
  function check(host, target, mac, flow, attempt = 1) {
    host.probing.add(target);
    transmit(host, {
      dst: mac,
      src: host.mac,
      type: ETHERTYPE_IPV6,
      ip: { src: sourceFor(host, target), dst: target, ttl: ND_HOP_LIMIT },
      nd: { type: ND_NS, target, lla: host.mac },
      flow,
    });
    log(
      attempt === 1
        ? `${host.name} checks that ${target} is still at ${mac}: a Neighbor Solicitation sent straight to it.`
        : `No answer yet: ${host.name} checks ${target} again (try ${attempt} of ${MAX_SOLICIT}).`,
    );
    schedule(ROUND_TRIP_MS + RETRANS_MS, () => {
      if (!host.probing.has(target)) return;
      if (attempt < MAX_SOLICIT) return check(host, target, mac, flow, attempt + 1);
      host.probing.delete(target);
      host.neighbors.delete(target);
      emit('cache:expire', { host: host.name, ip: target });
      log(`${target} didn't answer ${MAX_SOLICIT} checks, so ${host.name} deletes its neighbor cache entry.`);
    });
  }

  /**
   * @param {Host} host
   * @param {string} mac  The next hop's MAC.
   * @param {Packet} packet
   */
  function sendData(host, mac, packet) {
    const { ip, app, reply, flow, via } = packet;
    const frame = /** @type {Frame} */ ({
      id: sim.frameId(),
      dst: mac,
      src: host.mac,
      type: ETHERTYPE_IPV6,
      ip,
      app,
      reply,
      flow,
      ...(via ? { parent: via.id } : {}), // like Python's {**({'parent': ...} if via else {})}
    });
    if (via) {
      const to = nameOfMac(mac);
      emit('frame:forward', { frame: via, out: frame, node: host.name, to, time: state.clock });
      log(
        `${host.name} removes the upstream Ethernet header, lowers the hop limit from ${via.ip.ttl} to ${ip.ttl} and ` +
          `builds a new frame for the LAN: from its own MAC ${host.mac} to ${to}'s ${mac}. The IPv6 addresses stay ${ip.src} → ${ip.dst}.`,
      );
    } else {
      log(`${host.name} sends ${labelOf(packet)} to ${ip.dst} in a frame addressed to ${mac}.`);
    }
    transmitFrame(host, frame);
  }

  /**
   * An answer from the internet for the LAN: R1 routes it on, with Neighbor Discovery first if it must.
   * @param {Host} router
   * @param {Frame} frame
   */
  function fromUpstream(router, frame) {
    const { ip } = frame;
    if (!onLink(ip.dst)) return;
    /** @type {Packet} */
    const packet = { ip: { ...ip, ttl: ip.ttl - 1 }, app: frame.app ?? 'ping', reply: Boolean(frame.reply), flow: frame.flow, via: frame };
    if (!router.neighbors.has(ip.dst)) {
      log(`${router.name} has a packet for ${ip.dst} on its LAN but no MAC for it, so it uses Neighbor Discovery too.`);
    }
    deliver(router, ip.dst, packet);
  }

  /** REACHABLE entries whose time is up turn STALE; MAC-table entries expire. */
  function expire() {
    for (const host of Object.values(state.hosts)) {
      for (const [addr, entry] of host.neighbors) {
        if (entry.state === 'REACHABLE' && /** @type {number} */ (entry.reachableUntil) <= state.clock) {
          host.neighbors.set(addr, { mac: entry.mac, state: 'STALE' });
          emit('cache:stale', { host: host.name, ip: addr });
        }
      }
    }
    sw.expire();
  }

  /**
   * An application on host `src` wants to reach `dst` (any valid IPv6 spelling).
   * @param {string} src
   * @param {string} dstText
   * @param {App} [app]
   */
  function send(src, dstText, app = 'ping') {
    const host = hostNamed(src);
    const dst = normalize(dstText);
    if (!dst) throw new Error(`Not an IPv6 address: ${dstText}`);
    if (host.down) {
      log(`${src} is down, so it sends nothing.`);
      return;
    }
    if (owns(host, dst)) {
      log(`${dst} is ${src}'s own address: nothing needs to go on the wire.`);
      return;
    }
    const flow = sim.flowId();
    const local = onLink(dst);
    if (!local && host.role === 'gateway') {
      uplink.originate(host, dst, app, flow);
      return;
    }
    const nextHop = nextHopFor(dst);
    /** @type {Packet} */
    const packet = { ip: { src: sourceFor(host, dst), dst, ttl: HOP_LIMIT }, app, reply: false, flow };
    const entry = host.neighbors.get(nextHop);
    if (entry?.state === 'REACHABLE') {
      log(`${src} already has ${nextHop} in its neighbor cache (${entry.mac}, REACHABLE), so no Neighbor Discovery is needed.`);
      sendData(host, entry.mac, packet);
      return;
    }
    if (!entry) {
      const why =
        `${src} wants to send ${APP_LABEL[app]} to ${dst}. The application knows only the IPv6 address, but ` +
        `Ethernet delivers frames by MAC address, so ${src} needs a MAC to put in the frame.`;
      log(
        local
          ? `${why} ${dst} is on this link and not in ${src}'s neighbor cache, so ${src} asks for it with Neighbor Discovery.`
          : `${why} ${dst} is not on this link, so the packet goes to the default router, R1 (${DEFAULT_ROUTER}). ` +
              `${src} asks for the router's MAC, not ${dst}'s. Real hosts learn their default router from R1's Router Advertisements.`,
      );
    }
    deliver(host, nextHop, packet);
  }

  /**
   * A host fails: its switch port goes down, so SW1 forgets the MACs it learnt there.
   * @param {string} name
   */
  function fail(name) {
    const host = hostNamed(name);
    host.down = true;
    emit('host:down', { host: name, time: state.clock });
    log(`${name} fails. ${SWITCH} sees its port ${host.port} go down and forgets the MAC addresses learnt there.`);
    sw.forgetPort(host.port);
  }

  /**
   * Fill in a REACHABLE cache entry from the topology, as if the hosts had just talked.
   * @param {string} name
   * @param {string} addrText
   */
  function primeCache(name, addrText) {
    const host = hostNamed(name);
    const addr = normalize(addrText);
    const owner = Object.values(state.hosts).find((h) => addr !== null && owns(h, addr));
    if (!addr || !owner) throw new Error(`Cannot prime ${name} with ${addrText}`);
    setNeighbor(host, addr, owner.mac, 'REACHABLE');
    log(`${name} already has ${addr} at ${owner.mac} in its neighbor cache from earlier traffic.`);
  }

  /** @param {number} ms  How long an answered neighbour stays REACHABLE, kept within 10–300 s. */
  function setReachableMs(ms) {
    state.reachableMs = Math.min(MAX_REACHABLE_MS, Math.max(MIN_REACHABLE_MS, ms));
  }

  return {
    state,
    on,
    emit,
    send,
    fail,
    primeCache,
    setReachableMs,
    tick: sim.tick,
    runUntilIdle: sim.runUntilIdle,
    isIdle: sim.isIdle,
    nextEventAt: sim.nextEventAt,
  };
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/games/nd/engine.test.js` — expected PASS. Investigate any failure against the spec (section 13, "Engine") before touching a test.

- [ ] **Step 5: Check and commit**

```bash
npm run format && npm run check
git add src/games/nd/engine.js src/games/nd/engine.test.js
git commit -m "feat(nd): Neighbor Discovery engine: solicitations, REACHABLE/STALE, checks, retries, off-link (R18)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Engine, part 2: DAD and unsolicited NA

**Files:**
- Modify: `src/games/nd/engine.js`, `src/games/nd/engine.test.js`

**Interfaces:**
- Consumes: everything from Task 4.
- Produces: `claimIp(name, addr, why?, { announce }?)`, `takeOver(name, addr)`; events `dad:ok` `{ host, ip, time }`, `dad:duplicate` `{ host, ip, mac, time }`, `host:change` `{ host }`.

- [ ] **Step 1: Write the failing tests.** Append to `src/games/nd/engine.test.js` (add `'dad:ok'`, `'dad:duplicate'` and `'host:change'` to `record`'s event list first):

```js
describe('Duplicate Address Detection (RFC 4862)', () => {
  const G3 = '2001:db8:0:1::13';

  it('H3 joins: asks from :: with no MAC option, waits, then uses the address', () => {
    const engine = createEngine();
    const r = record(engine);
    engine.claimIp('H3', G3);
    expect(engine.state.hosts.H3).toMatchObject({ global: null, tentative: G3 });
    expect(r.sent()[0].frame).toMatchObject({
      dst: '33:33:ff:00:00:13',
      ip: { src: '::', dst: 'ff02::1:ff00:13', ttl: 255 },
      nd: { type: 135, target: G3 },
    });
    expect(r.sent()[0].frame.nd.lla).toBeUndefined();
    engine.runUntilIdle();
    expect(r.of('dad:ok')).toEqual([{ host: 'H3', ip: G3, time: ROUND_TRIP_MS + RETRANS_MS }]);
    expect(engine.state.hosts.H3).toMatchObject({ global: G3, tentative: null });
    expect(r.of('host:change')).toHaveLength(2);
    for (const host of Object.values(engine.state.hosts)) expect(host.neighbors.size).toBe(0);
  });

  it('an owner defends its address; the newcomer marks it duplicate and never uses it', () => {
    const engine = createEngine();
    engine.primeCache('H1', G2);
    engine.primeCache('R1', G2);
    const r = record(engine);
    engine.claimIp('H3', G2);
    engine.runUntilIdle();
    const defence = r.sent().find((hop) => hop.from === 'H2')?.frame;
    expect(defence).toMatchObject({
      dst: '33:33:00:00:00:01',
      ip: { src: G2, dst: 'ff02::1', ttl: 255 },
      nd: { type: 136, target: G2, lla: MAC.H2, solicited: false, override: true },
    });
    expect(r.of('dad:duplicate')).toEqual([{ host: 'H3', ip: G2, mac: MAC.H2, time: 4 * HOP_MS }]);
    expect(engine.state.hosts.H3).toMatchObject({ global: null, tentative: null, duplicate: G2 });
    expect(r.of('dad:ok')).toEqual([]);
    // Nobody's traffic moves: H1 and R1 still have H2's MAC, and H2 cached nothing from ::.
    expect(engine.state.hosts.H1.neighbors.get(G2)?.mac).toBe(MAC.H2);
    expect(engine.state.hosts.R1.neighbors.get(G2)?.mac).toBe(MAC.H2);
    expect(engine.state.hosts.H2.neighbors.size).toBe(0);
    expect(r.sent().filter((hop) => hop.from === 'H3' && hop.frame.ip.src === G2)).toEqual([]);
  });
});

describe('unsolicited Neighbor Advertisement', () => {
  it('updates an entry that exists, as STALE with the new MAC, and is ignored where there is none', () => {
    const engine = createEngine();
    engine.primeCache('H1', G2);
    const r = record(engine);
    engine.fail('H2');
    engine.takeOver('H3', G2);
    engine.runUntilIdle();
    const na = r.sent().find((hop) => hop.from === 'H3' && hop.frame.nd?.type === 136)?.frame;
    expect(na).toMatchObject({ dst: '33:33:00:00:00:01', ip: { src: G2, dst: 'ff02::1' }, nd: { solicited: false, override: true, lla: MAC.H3 } });
    expect(engine.state.hosts.H1.neighbors.get(G2)).toEqual({ mac: MAC.H3, state: 'STALE' });
    expect(engine.state.hosts.R1.neighbors.has(G2)).toBe(false);
    expect(r.text()).toMatch(/R1 has no entry for 2001:db8:0:1::12, so it ignores the advertisement/);
  });

  it('failover: after the takeover, a ping to the address is answered by H3, confirmed by a check', () => {
    const engine = createEngine();
    engine.primeCache('H1', G2);
    engine.primeCache('R1', G2);
    engine.fail('H2');
    engine.takeOver('H3', G2);
    engine.runUntilIdle();
    const r = record(engine);
    engine.send('H1', G2);
    engine.runUntilIdle();
    expect(r.sent()[0].frame).toMatchObject({ dst: MAC.H3, app: 'ping' });
    expect(r.sent()[1].frame).toMatchObject({ dst: MAC.H3, nd: { type: 135, target: G2 } });
    expect(engine.state.hosts.H1.neighbors.get(G2)).toMatchObject({ mac: MAC.H3, state: 'REACHABLE' });
    expect(r.text()).toMatch(/H3 receives a ping \(ICMPv6 echo request\) from 2001:db8:0:1::11/);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/games/nd/engine.test.js` — expected FAIL: `engine.claimIp is not a function`.

- [ ] **Step 3: Implement.** In `src/games/nd/engine.js`:
  1. Import `UNSPECIFIED` from `./ipv6.js` too.
  2. At the top of `receiveSolicitation`, right after the `const { ip } = frame;` line, add:

```js
    if (ip.src === UNSPECIFIED) {
      // Duplicate Address Detection (RFC 4862 §5.4.3): the owner defends; nobody caches anything from ::.
      if (!owns(host, nd.target)) return drop(host, frame, 'not my address');
      log(`${host.name} already uses ${nd.target}, so it defends it: a Neighbor Advertisement to all nodes saying ${nd.target} is at ${host.mac}.`);
      advertise(host, nd.target, frame.flow);
      return;
    }
```

  3. At the top of `receiveAdvertisement`, right after the `const lla = …;` line, add:

```js
    if (host.tentative === nd.target) {
      host.tentative = null;
      host.duplicate = nd.target;
      joinGroups(host);
      emit('dad:duplicate', { host: host.name, ip: nd.target, mac: lla, time: state.clock });
      emit('host:change', { host: host.name });
      log(
        `${host.name} hears ${lla} defend ${nd.target}: the address is already in use. DAD failed, so ${host.name} marks it duplicate and never uses it. Nobody's traffic goes to the wrong host.`,
      );
      return;
    }
    if (!nd.solicited) return receiveUnsolicited(host, frame);
```

  4. Add these functions after `receiveAdvertisement`:

```js
  /**
   * An advertisement nobody asked for (RFC 4861 §7.2.5): with Override, it moves an existing
   * entry to the new MAC, as STALE until checked. Unlike gratuitous ARP, it never creates one.
   * @param {Host} host
   * @param {Frame} frame
   */
  function receiveUnsolicited(host, frame) {
    const nd = /** @type {import('./frames.js').NdMessage} */ (frame.nd);
    const lla = /** @type {string} */ (nd.lla);
    const had = host.neighbors.get(nd.target);
    if (!had) {
      log(`${host.name} has no entry for ${nd.target}, so it ignores the advertisement: unlike gratuitous ARP, an unsolicited advertisement never creates an entry.`);
      return drop(host, frame, 'no entry: ignored');
    }
    if (had.mac === lla || !nd.override) return;
    setNeighbor(host, nd.target, lla, 'STALE');
    log(`${host.name} updates ${nd.target}: it was ${had.mac}, now ${lla}, marked STALE until it is checked.`);
  }

  /**
   * An advertisement to all nodes: a defence during DAD, or the announcement after a takeover.
   * @param {Host} host
   * @param {string} addr
   * @param {number} flow
   */
  function advertise(host, addr, flow) {
    transmit(host, {
      dst: ALL_NODES_MAC,
      src: host.mac,
      type: ETHERTYPE_IPV6,
      ip: { src: addr, dst: ALL_NODES, ttl: ND_HOP_LIMIT },
      nd: { type: ND_NA, target: addr, lla: host.mac, router: host.role === 'gateway', solicited: false, override: true },
      flow,
    });
  }

  /**
   * Give a host an address through Duplicate Address Detection (RFC 4862 §5.4): ask from ::
   * whether anyone uses it, wait a second, then use it, unless an owner defends it.
   * @param {string} name
   * @param {string} addrText
   * @param {string} [why]  The log line saying how the host came to claim it.
   * @param {{ announce?: boolean }} [options]  announce: send an unsolicited NA once the address is usable.
   */
  function claimIp(name, addrText, why, { announce = false } = {}) {
    const host = hostNamed(name);
    const addr = normalize(addrText);
    if (!addr) throw new Error(`Not an IPv6 address: ${addrText}`);
    log(why ?? `${name} is given the address ${addr}. Before using it, it checks that no other device has it: Duplicate Address Detection.`);
    host.global = null;
    host.duplicate = null;
    host.tentative = addr;
    joinGroups(host);
    emit('host:change', { host: name });
    const group = solicitedNode(addr);
    transmit(host, {
      dst: multicastMac(group),
      src: host.mac,
      type: ETHERTYPE_IPV6,
      ip: { src: UNSPECIFIED, dst: group, ttl: ND_HOP_LIMIT },
      nd: { type: ND_NS, target: addr },
      flow: sim.flowId(),
    });
    log(`${name} sends a Neighbor Solicitation from the unspecified address :: to ${group}: is anyone using ${addr}? It can't use the address as a source until the check passes.`);
    schedule(ROUND_TRIP_MS + RETRANS_MS, () => {
      if (host.tentative !== addr) return; // a defence arrived first
      host.tentative = null;
      host.global = addr;
      joinGroups(host);
      emit('dad:ok', { host: name, ip: addr, time: state.clock });
      emit('host:change', { host: name });
      log(`No one answered within a second: ${addr} is unique on this link, and ${name} starts using it.`);
      if (announce) {
        log(
          `${name} sends an unsolicited Neighbor Advertisement to all nodes (${ALL_NODES}): ${addr} is now at ${host.mac}. Its Override flag tells neighbors that already have ${addr} to switch to the new MAC.`,
        );
        advertise(host, addr, sim.flowId());
      }
    });
  }

  /**
   * Failover: a standby takes over an address (DAD, then an unsolicited NA).
   * @param {string} name
   * @param {string} addr
   */
  function takeOver(name, addr) {
    claimIp(name, addr, `${name}, the standby, stops hearing from the host that had ${normalize(addr)} and takes the address over.`, {
      announce: true,
    });
  }
```

  5. Add `claimIp,` and `takeOver,` to the returned object, after `fail,`. Update the header comment: replace "and, in Task 5, Duplicate Address Detection (RFC 4862)" with "and Duplicate Address Detection (RFC 4862)".

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/games/nd/engine.test.js` — expected PASS (all of Task 4's tests too).

- [ ] **Step 5: Check and commit**

```bash
npm run format && npm run check
git add src/games/nd/engine.js src/games/nd/engine.test.js
git commit -m "feat(nd): Duplicate Address Detection, defences and unsolicited advertisements (R18)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Hop notes and the Learn lesson (`nd/hops.js`, `nd/lesson.js`)

**Files:**
- Create: `src/games/nd/hops.js`, `src/games/nd/hops.test.js`, `src/games/nd/lesson.js`, `src/games/nd/lesson.test.js`
- Modify: `docs/SPEC.md` (section 13, "Modes", the Learn list)

**Interfaces:**
- Consumes: `buildHopRows` (shared), Task 3's `appLabel`, `frameKind`, `ND_NS`; Task 4/5's engine; `playLesson`, `tickToward`, `watchStep` (shared).
- Produces: `hopRows(hops, nameOf)`; `LESSON` (introduction plus 9 steps), `playTo(engine, to, from = 0)`, and re-exports `watchStep`, `tickToward`.

**Why the steps are drawn this way.** A step ends on an engine event and the next step starts listening only when the visitor presses Next. Two steps must therefore never end in the same tick: the second one's event would already have fired. The exchange's ticks are 0 ms (H1's NS), 600 (SW1 floods), 1200 (H2 caches H1 and answers; H3 and R1 drop), 1800 (SW1 forwards the NA), 2400 (H1 REACHABLE, sends the ping), 3600 (H2 gets the ping, replies and checks), 4800 (H1 gets the reply and answers the check), 6000 (H2 REACHABLE). So the design's separate "which group to ask" step joins step 1, and "H2 caches H1 as STALE" is told as SW1 forwards the answer. The test checks the end times rise strictly.

- [ ] **Step 1: Write the failing tests**

`src/games/nd/hops.test.js`:

```js
import { describe, expect, it } from 'vitest';
import { createEngine, TOPOLOGY } from './engine.js';
import { hopRows } from './hops.js';

/** @param {(engine: ReturnType<typeof createEngine>) => void} run */
function hopsOf(run) {
  const engine = createEngine();
  /** @type {any[]} */
  const hops = [];
  engine.on('frame:emit', (hop) => hops.push(hop));
  run(engine);
  engine.runUntilIdle();
  return hops;
}

/** @param {string} mac */
const nameOf = (mac) => TOPOLOGY.nodes.find((n) => n.mac === mac)?.name ?? mac;

describe('hopRows', () => {
  it('tells what each device meant: the group question, the answer, the check', () => {
    const rows = hopRows(hopsOf((e) => e.send('H1', '2001:db8:0:1::12')), nameOf);
    const notes = rows.filter((r) => r.from !== 'SW1').map((r) => r.note);
    expect(notes[0]).toBe('H1 asks 2001:db8:0:1::12’s solicited-node group, ff02::1:ff00:12: who has 2001:db8:0:1::12?');
    expect(notes[1]).toBe('H2 answers only H1: 2001:db8:0:1::12 is at 00:00:5e:00:53:12.');
    expect(notes).toContain('H2 checks that 2001:db8:0:1::11 is still at H1.');
    expect(rows[1]).toMatchObject({ from: 'SW1', to: ['H2', 'H3', 'R1'], ethDst: '33:33:ff:00:00:12' });
  });

  it('tells DAD and an announcement apart', () => {
    const rows = hopRows(
      hopsOf((e) => {
        e.fail('H2');
        e.takeOver('H3', '2001:db8:0:1::12');
      }),
      nameOf,
    );
    const notes = rows.filter((r) => r.from === 'H3').map((r) => r.note);
    expect(notes).toEqual([
      'H3 checks that nobody else uses 2001:db8:0:1::12 (DAD), from the unspecified address ::.',
      'H3 tells all nodes: 2001:db8:0:1::12 is at 00:00:5e:00:53:13.',
    ]);
  });

  it('marks what R1 rebuilt with the hop limit', () => {
    const rows = hopRows(hopsOf((e) => e.send('H1', '2001:db8:8888::8')), nameOf);
    const rebuilt = rows.find((r) => r.from === 'R1' && r.changed.length);
    expect(rebuilt?.note).toMatch(/Hop limit 64 → 63/);
  });
});
```

`src/games/nd/lesson.test.js`:

```js
import { describe, expect, it } from 'vitest';
import { createEngine } from './engine.js';
import { LESSON, playTo, watchStep } from './lesson.js';

const G1 = '2001:db8:0:1::11';
const G2 = '2001:db8:0:1::12';

/** The clock at which each step ends, playing the lesson from the start. */
function endTimes() {
  const engine = createEngine();
  const times = [];
  for (let n = 1; n < LESSON.length; n++) {
    playTo(engine, n, n - 1);
    times.push(engine.state.clock);
  }
  return times;
}

describe('the Learn lesson', () => {
  it('has an introduction and 9 steps, each with a caption and a short note', () => {
    expect(LESSON).toHaveLength(10);
    for (const step of LESSON) {
      expect(step.caption.length).toBeGreaterThan(40);
      expect(step.note.text.length).toBeLessThanOrEqual(60);
    }
  });

  it('ends every step later than the one before, so no step’s event can be missed', () => {
    const times = endTimes();
    for (let i = 1; i < times.length; i++) expect(times[i]).toBeGreaterThan(times[i - 1]);
  });

  it('leaves the state each step describes', () => {
    const engine = createEngine();
    /** @type {string[]} */
    const drops = [];
    engine.on('frame:drop', (d) => drops.push(`${d.node}: ${d.reason}`));
    playTo(engine, 3);
    expect(drops).toEqual(['H3: not my group (network card)', 'R1: not my group (network card)']);
    expect(engine.state.hosts.H2.neighbors.get(G1)?.state).toBe('STALE');
    playTo(engine, 5, 3);
    expect(engine.state.hosts.H1.neighbors.get(G2)?.state).toBe('REACHABLE');
    playTo(engine, 8, 5);
    expect(engine.state.hosts.H2.neighbors.get(G1)?.state).toBe('REACHABLE');
  });

  it('pings again in the last step with no Neighbor Discovery', () => {
    const engine = createEngine();
    playTo(engine, 8);
    /** @type {any[]} */
    const frames = [];
    engine.on('frame:emit', (hop) => frames.push(hop.frame));
    playTo(engine, 9, 8);
    expect(frames.length).toBeGreaterThan(0);
    expect(frames.filter((f) => f.nd)).toEqual([]);
  });

  it('Back rebuilds the same state', () => {
    const a = createEngine();
    const b = createEngine();
    playTo(a, 6);
    playTo(b, 5);
    playTo(b, 6, 5);
    expect(b.state.clock).toBe(a.state.clock);
    expect([...b.state.hosts.H2.neighbors]).toEqual([...a.state.hosts.H2.neighbors]);
  });

  it('lets watchStep report a step’s end during live playback', () => {
    const engine = createEngine();
    let done = false;
    watchStep(engine, LESSON[1], () => (done = true));
    LESSON[1].start?.(engine);
    expect(done).toBe(true);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/games/nd/hops.test.js src/games/nd/lesson.test.js` — expected FAIL, unresolved imports.

- [ ] **Step 3: Write `src/games/nd/hops.js`**

```js
/**
 * Neighbor Discovery's hop table (spec section 13): the shared rows from src/games/lan/hops.js,
 * with ND's notes for what a device meant by each frame. DOM-free.
 */
import { buildHopRows } from '../lan/hops.js';
import { appLabel, frameKind, ND_NS } from './frames.js';

/** @typedef {import('../lan/hops.js').HopRow} HopRow */

/**
 * What a device meant by a frame it sent.
 * @param {any} frame
 * @param {string} from
 * @param {HopRow} row
 */
function origin(frame, from, row) {
  const { nd, ip } = frame;
  if (!nd) return `${from} wraps the ${appLabel(frame).long} in a frame for ${row.ethDst}.`;
  if (nd.type === ND_NS) {
    if (ip.src === '::') return `${from} checks that nobody else uses ${nd.target} (DAD), from the unspecified address ::.`;
    if (ip.dst === nd.target) return `${from} checks that ${nd.target} is still at ${row.ethDst}.`;
    return `${from} asks ${nd.target}’s solicited-node group, ${ip.dst}: who has ${nd.target}?`;
  }
  if (!nd.solicited) return `${from} tells all nodes: ${nd.target} is at ${nd.lla}.`;
  return `${from} answers only ${row.ethDst}: ${nd.target} is at ${nd.lla}.`;
}

/**
 * @param {{ frame: any, from: string, to: string, how?: 'flood' | 'forward' }[]} hops  One flow's frame:emit payloads, in order.
 * @param {(mac: string) => string} nameOf
 * @returns {HopRow[]}
 */
export function hopRows(hops, nameOf) {
  return buildHopRows(hops, { nameOf, kindOf: frameKind, origin, hopName: 'Hop limit' });
}
```

- [ ] **Step 4: Write `src/games/nd/lesson.js`**

```js
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
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/games/nd` — expected PASS. If "ends every step later than the one before" fails, a step ends in the same tick as the one before: move its `until` to a later event, never weaken the test.

- [ ] **Step 6: Record the lesson's shape in the spec.** In `docs/SPEC.md` section 13, "Modes", replace the numbered Learn list (items 1–9) with the steps as built (titles above, one line each), and add one sentence after it: "No two steps end in the same tick of the simulation (a test checks), so the design's separate "which group to ask" step is part of step 1, and H2's STALE entry is told while SW1 forwards the answer."

- [ ] **Step 7: Check and commit**

```bash
npm run format && npm run check
git add src/games/nd/hops.js src/games/nd/hops.test.js src/games/nd/lesson.js src/games/nd/lesson.test.js docs/SPEC.md
git commit -m "feat(nd): hop-table notes and the Learn lesson (R18)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: View, controller and page (`/learn/nd`)

**Files:**
- Create: `src/games/nd/renderer.js`, `src/games/nd/controller.js`, `src/pages/learn/nd.astro`, `src/content/learn/nd.md`
- Modify: `src/content/tags.yaml`, `tests/smoke.spec.js`

**Interfaces:**
- Consumes: everything from Tasks 1–6; `mountLanRenderer`, `NEXT_HOP` (shared renderer); `startLanSimulator` (shared controller); `LanSimulator.astro` props (`prefix`, `modes`, `sendModes`, `hosts`, `dest`, `quick`, `ttl`, `legend`, `diagramLabel`, `cacheTitle`; slot `mode-panels`).
- Produces: `mountRenderer(parts, engine, options)` and `startSimulator(root)` for ND; the page `/learn/nd`.

- [ ] **Step 1: Write the failing Playwright tests.** In `tests/smoke.spec.js`, add `'/learn/nd'` after `'/learn/arp'` in `ROUTES`, and add this block after the ARP block:

```js
test.describe('How IPv6 Neighbor Discovery works (R18, section 13)', () => {
  /**
   * Pause, send from H1, then step until the log shows `until`.
   * @param {import('@playwright/test').Page} page
   * @param {string} address
   * @param {string} until
   */
  async function sendAndStep(page, address, until) {
    await page.goto('/learn/nd');
    await page.getByRole('button', { name: 'Pause' }).click();
    await page.getByLabel('To IPv6 address').fill(address);
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    const step = page.getByRole('button', { name: 'Step' });
    for (let i = 0; i < 40 && (await step.isEnabled()); i++) {
      if ((await page.locator('.log').textContent())?.includes(until)) break;
      await step.click();
    }
  }

  test('a first ping fills both neighbor caches, H3’s card drops the solicitation', async ({ page }) => {
    await sendAndStep(page, '2001:db8:0:1::12', 'H1 learns that 2001:db8:0:1::12');
    await expect(page.locator('.cache[data-host="H1"]')).toContainText('REACHABLE');
    await expect(page.locator('.cache[data-host="H2"]')).toContainText('STALE');
    await expect(page.locator('.log')).toContainText('solicited-node group, ff02::1:ff00:12 (33:33:ff:00:00:12)');
    await expect(page.locator('.mac-table tr[data-key="00:00:5e:00:53:11"]')).toContainText('Gi0/1');
  });

  test('Inspect shows a Neighbor Solicitation’s 86 bytes, its rows and its notes', async ({ page }) => {
    await sendAndStep(page, '2001:db8:0:1::12', 'H2 has 2001:db8:0:1::12');
    await page.locator('.log .inspect').first().click();
    const packet = page.locator('.packet');
    await expect(packet.locator('h2')).toHaveText('Neighbor Solicitation: who has 2001:db8:0:1::12?');
    await expect(packet).toHaveAttribute('data-kind', 'request');
    await expect(packet.locator('.strip .label')).toHaveText(['Destination MAC', 'Source MAC', 'Type', 'IPv6 header', 'ICMPv6 NS', 'FCS']);
    await expect(packet.locator('.packet-notes')).toContainText('Hop limit 255');
    await packet.getByText('Bytes: all 86').click();
    await expect(packet.locator('.byte')).toHaveCount(86);
  });

  test('the internet: R1 answers for fe80::1 and rewrites the hop limit', async ({ page }) => {
    await sendAndStep(page, '2001:db8:8888::8', 'new frame for its upstream link');
    await expect(page.locator('.log')).toContainText('default router, R1 (fe80::1)');
    const card = page.locator('.rewrite');
    await expect(card).toContainText('Hop limit');
    await expect(card.locator('s')).toHaveText(['R1', 'H1', '64']);
  });

  test('an unused address: three solicitations, then "address unreachable"', async ({ page }) => {
    await page.goto('/learn/nd');
    await page.getByLabel('Speed').selectOption('2');
    await page.getByRole('button', { name: 'an unused address' }).click();
    await expect(page.locator('.bubble')).toContainText('address unreachable', { timeout: 15_000 });
  });

  test('a bad or multicast address shows an error instead of sending', async ({ page }) => {
    await page.goto('/learn/nd');
    await page.getByLabel('To IPv6 address').fill('2001:db8::12::1');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.locator('#nd-dest-error')).toContainText('Enter an IPv6 address');
    await page.getByLabel('To IPv6 address').fill('ff02::1');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.locator('#nd-dest-error')).toContainText('unicast');
  });

  test('Learn mode walks through the exchange with Next and Back', async ({ page }) => {
    await page.goto('/learn/nd#learn');
    await page.getByRole('button', { name: 'Start' }).click();
    await expect(page.locator('#lesson-title')).toHaveText('Why Neighbor Discovery?');
    const next = page.getByRole('button', { name: 'Next' });
    for (let i = 0; i < 8; i++) await next.click();
    await expect(page.locator('#lesson-title')).toHaveText('Ping again: no Neighbor Discovery');
    await page.getByRole('button', { name: 'Back' }).click();
    await expect(page.locator('#lesson-title')).toHaveText('H2’s check is answered');
    await expect(page.locator('.cache[data-host="H2"]')).toContainText('REACHABLE');
  });

  test('DAD: a defended address is refused and no cache changes', async ({ page }) => {
    await page.goto('/learn/nd#dad');
    await page.getByLabel('Speed').selectOption('2');
    await page.getByRole('button', { name: 'Duplicate address' }).click();
    await expect(page.locator('.bubble')).toContainText('Duplicate address', { timeout: 10_000 });
    await expect(page.locator('[data-node="H3"]')).toContainText('duplicate');
    await expect(page.locator('.cache[data-host="H1"]')).toContainText('00:00:5e:00:53:12');
  });

  test('Failover: caches move to H3 as STALE', async ({ page }) => {
    await page.goto('/learn/nd#dad');
    await page.getByLabel('Speed').selectOption('2');
    await page.getByRole('button', { name: /^Failover/ }).click();
    await expect(page.locator('[data-node="H2"]')).toContainText('(down)');
    await expect(page.locator('.cache[data-host="H1"]')).toContainText('00:00:5e:00:53:13', { timeout: 10_000 });
    await expect(page.locator('.cache[data-host="H1"]')).toContainText('STALE');
  });

  test('a host can be failed from Sandbox', async ({ page }) => {
    await page.goto('/learn/nd');
    await page.getByLabel('Fail a host').selectOption('H3');
    await page.getByRole('button', { name: 'Fail', exact: true }).click();
    await expect(page.locator('[data-node="H3"]')).toContainText('(down)');
  });

  test('the ARP vs ND table and the addressing note are on the page', async ({ page }) => {
    await page.goto('/learn/nd');
    await expect(page.getByRole('table', { name: /ARP and Neighbor Discovery/ })).toBeVisible();
    await expect(page.getByText('RFC 7217')).toBeVisible();
  });
});
```

Also, in the "the interactive parts run without a single violation" CSP test, after the ARP steps add:

```js
    await page.goto('/learn/nd');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.locator('.cache[data-host="H1"]')).toContainText('00:00:5e:00:53:12', { timeout: 10_000 });
```

Run: `npm run build && npx playwright test -g "Neighbor Discovery"` — expected FAIL (the route doesn't exist yet).

- [ ] **Step 2: Content.** Create `src/content/learn/nd.md` (use today's date for `published` and `updated`):

```markdown
---
title: How IPv6 Neighbor Discovery works
summary: Play a host on an IPv6 LAN and watch Neighbor Discovery find a neighbor's MAC, with multicast instead of broadcast.
description: "An interactive IPv6 Neighbor Discovery simulator: a Neighbor Solicitation reaches only its solicited-node group, then the advertisement, the neighbor cache and every frame's bytes."
published: 2026-10-28
updated: 2026-10-28
category: layer-2
kind: game
tags: [ipv6, neighbor-discovery, layer-2]
component: nd
---

Send traffic from a host, watch a solicitation reach only its group, and freeze any frame to inspect its bytes.
```

In `src/content/tags.yaml`, add after `arp:`:

```yaml
ipv6:
  name: IPv6
neighbor-discovery:
  name: Neighbor Discovery
```

- [ ] **Step 3: The view config** `src/games/nd/renderer.js`

```js
/**
 * The Neighbor Discovery simulator's view (spec section 13): the shared LAN view
 * (src/games/lan/renderer.js) with ND's layout, labels, neighbor-cache columns and bubbles.
 */
import { mountLanRenderer, NEXT_HOP } from '../lan/renderer.js';
import { HOP_MS, MAC_AGE_MS, TOPOLOGY } from './engine.js';
import { breakdown, describeFrame, encodeFrame, frameFields, frameKind, frameLabel, frameNotes } from './frames.js';
import { hopRows } from './hops.js';

/**
 * Where everything sits: the ARP game's places, with taller boxes for two address lines.
 * @type {Record<'wide' | 'narrow', import('../lan/renderer.js').Layout>}
 */
export const LAYOUTS = {
  wide: {
    viewBox: '0 0 900 500',
    box: { w: 176, h: 104 },
    macSize: 12.5,
    addrSize: 12.5,
    card: 'above',
    places: {
      H1: { x: 110, y: 85 },
      H2: { x: 110, y: 250 },
      H3: { x: 110, y: 415 },
      SW1: { x: 420, y: 250 },
      R1: { x: 640, y: 250 },
      [NEXT_HOP]: { x: 830, y: 250 },
    },
  },
  narrow: {
    viewBox: '0 0 400 600',
    box: { w: 122, h: 100 },
    macSize: 10,
    addrSize: 10,
    card: 'right',
    places: {
      H1: { x: 66, y: 62 },
      H2: { x: 200, y: 62 },
      H3: { x: 334, y: 62 },
      SW1: { x: 200, y: 245 },
      R1: { x: 110, y: 410 },
      [NEXT_HOP]: { x: 110, y: 548 },
    },
  },
};

/**
 * The address lines in a node's box: its global address (or the one DAD is checking, or the
 * one DAD refused), then its link-local address.
 * @param {any} node
 */
function addressLines(node) {
  const global = node.global ?? (node.tentative ? `${node.tentative} (DAD)` : node.duplicate ? `${node.duplicate} duplicate` : 'no global address');
  return [global, node.linkLocal];
}

/** @type {import('../lan/renderer.js').LanView} */
const ND_VIEW = {
  layouts: LAYOUTS,
  upstream: TOPOLOGY.upstream,
  hopMs: HOP_MS,
  hopName: 'Hop limit',
  lifetime: { cache: (engine) => /** @type {any} */ (engine).state.reachableMs, mac: () => MAC_AGE_MS },
  addressLines,
  frameKind,
  frameLabel,
  describe: describeFrame,
  cache: {
    columns: ['Address', 'MAC', 'State'],
    // Like Python's [(addr, e) for addr, e in host.neighbors.items()]; only REACHABLE counts down.
    rows: (host) =>
      [...host.neighbors].map(([addr, entry]) => ({
        key: addr,
        values: [addr, entry.mac, entry.state],
        ...(entry.state === 'REACHABLE' ? { expiresAt: entry.reachableUntil } : {}),
      })),
  },
  bubbles: {
    'nd:unreachable': ({ host }) => ({
      host,
      text: 'No answer to 3 Neighbor Solicitations, a second apart: the application gets "address unreachable".',
    }),
    'dad:duplicate': ({ host, ip, mac }) => ({ host, text: `Duplicate address! ${mac} already uses ${ip}, so ${host} won’t use it.` }),
  },
  hopRows,
  packet: {
    kindOf: frameKind,
    describe: describeFrame,
    breakdown,
    fields: frameFields,
    bytes: encodeFrame,
    bytesSummary: (frame, bytes) =>
      bytes.length > 14 ? `Bytes: all ${bytes.length} on the wire (without the FCS)` : 'Bytes: the 14-byte Ethernet header',
    hopFrame: (row) => (row.frame.nd ? (row.frame.nd.type === 135 ? 'NS' : 'NA') : row.frame.app),
    notes: frameNotes,
  },
};

/**
 * Draw the Neighbor Discovery simulation and keep it in step with the engine.
 * @param {Parameters<typeof mountLanRenderer>[0]} parts
 * @param {ReturnType<typeof import('./engine.js').createEngine>} engine
 * @param {{ onInspect?: (frame: any) => void }} [options]
 */
export function mountRenderer(parts, engine, options) {
  return mountLanRenderer(parts, /** @type {any} */ (engine), ND_VIEW, options);
}
```

- [ ] **Step 4: The controller** `src/games/nd/controller.js`

```js
/**
 * Starts the Neighbor Discovery simulator page (spec section 13, "Modes"): the shared LAN
 * controller (src/games/lan/controller.js) with ND's engine, view, lesson, address check,
 * the Sandbox fail control and the DAD and unsolicited NA scenarios.
 */
import { startLanSimulator } from '../lan/controller.js';
import { createEngine, DEFAULT_REACHABLE_MS } from './engine.js';
import { isMulticast, normalize } from './ipv6.js';
import { LESSON, playTo } from './lesson.js';
import { mountRenderer } from './renderer.js';

const H2_ADDR = '2001:db8:0:1::12';

/** @param {string} text  The error to show, or null when the address can be sent to. */
function checkAddress(text) {
  const addr = normalize(text);
  if (!addr) return 'Enter an IPv6 address, such as 2001:db8:0:1::12.';
  if (addr === '::' || isMulticast(addr)) return 'Enter a unicast address: the game sends to one device, not :: or a group.';
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
        sim.claimIp('H3', '2001:db8:0:1::13', 'H3 joins the network with the address 2001:db8:0:1::13. Before using it, it checks that no other device has it: Duplicate Address Detection.'),
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
      (sim) => sim.claimIp('H3', H2_ADDR, 'Meanwhile, on H3, someone sets a static address of 2001:db8:0:1::12, which is H2’s.'),
      'H2 defends its address, so H3 refuses it. H1’s and R1’s caches never change: nobody’s traffic goes to the wrong host.',
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
```

- [ ] **Step 5: The page** `src/pages/learn/nd.astro`. Copy `src/pages/learn/arp.astro` and change it as follows (everything not listed stays as in the ARP page: frontmatter imports, breadcrumbs, title, lede, tags, dates, `LessonPlace`, the lesson-text section, `LessonNav`, `BackHome`, and the page's own CSS for `.notice`, `.lesson-text`, `.dates` and `h2`):
  1. The doc comment: "Neighbor Discovery simulator (R18, spec section 13). The page holds the empty stage, panels and controls; src/games/nd/controller.js starts the engine and renderer in the browser. Without JavaScript it shows the addressing table and a note."
  2. Imports from `../../games/nd/engine.js` (`TOPOLOGY, DEFAULT_REACHABLE_MS, MIN_REACHABLE_MS, MAX_REACHABLE_MS`) and `../../games/nd/lesson.js` (`LESSON`); entry `getEntry('learn', 'nd')`, `lessonFor(course, 'nd')`, error texts naming `nd`; `path: '/learn/nd'`; `ogImage={shareCards.default}` and `image: shareCards.default.src` for now (Task 8 adds ND's own card).
  3. Data: `const hosts = TOPOLOGY.nodes;`, `hostOptions = hosts.map((node) => ({ name: node.name, label: \`${node.name} (${node.global})\` }))`, `reachableSeconds = DEFAULT_REACHABLE_MS / 1000`, and

```js
/** The mode switcher's choices; the value is also the URL hash (#learn, #dad). */
const MODES = [
  { value: 'learn', label: 'Learn' },
  { value: 'sandbox', label: 'Sandbox' },
  { value: 'dad', label: 'DAD and unsolicited NA' },
];
```

  4. The `<noscript>` table's columns: Node, Global address, Link-local, MAC, Switch port (`{node.global}/64`, `{node.linkLocal}`, `{node.mac}`, `{node.port}`).
  5. The simulator:

```astro
  <LanSimulator
    prefix="nd"
    modes={MODES}
    sendModes="sandbox dad"
    hosts={hostOptions}
    dest={{ label: 'To IPv6 address', value: '2001:db8:0:1::12', inputmode: 'text' }}
    quick={[
      { label: 'H2', value: '2001:db8:0:1::12' },
      { label: 'H3', value: '2001:db8:0:1::13' },
      { label: 'R1 (fe80::1)', value: 'fe80::1' },
      { label: 'an unused address', value: '2001:db8:0:1::99' },
      { label: 'the internet (2001:db8:8888::8)', value: '2001:db8:8888::8' },
    ]}
    ttl={{ label: 'Reachable time', min: MIN_REACHABLE_MS / 1000, max: MAX_REACHABLE_MS / 1000, value: reachableSeconds }}
    legend={[
      { kind: 'request', label: 'Neighbor Solicitation' },
      { kind: 'reply', label: 'Neighbor Advertisement' },
      { kind: 'data', label: 'IPv6 data (ping, web, DNS)' },
    ]}
    diagramLabel="Network diagram: three user devices and the router R1 on switch SW1, in IPv6"
    cacheTitle="Neighbor caches"
  >
    <section slot="mode-panels" class="nd-fail lan-panel" data-modes="sandbox">
      <label for="nd-fail-host">Fail a host</label>
      <select id="nd-fail-host">
        {hosts.map((node) => <option value={node.name}>{node.name}</option>)}
      </select>
      <button id="nd-fail" type="button">Fail</button>
    </section>
    <section slot="mode-panels" class="dad lan-panel" data-modes="dad" aria-labelledby="dad-title" hidden>
      <h2 id="dad-title">DAD and unsolicited NA</h2>
      <p>
        Before a host uses a new IPv6 address, it asks whether anyone else has it: Duplicate Address Detection, a
        Neighbor Solicitation sent from the unspecified address ::. An owner defends the address and the newcomer
        gives it up, before any traffic goes astray. A host taking over an address tells everyone with an unsolicited
        Neighbor Advertisement.
      </p>
      <div class="dad-row">
        <button id="dad-join" type="button">H3 joins</button>
        <button id="dad-failover" type="button">Failover: H2 fails, H3 takes over 2001:db8:0:1::12</button>
        <button id="dad-duplicate" type="button">Duplicate address</button>
      </div>
      <p class="dad-status" aria-live="polite"></p>
      <p class="dad-note">
        <strong>Note:</strong> Neighbor Discovery has no authentication of its own, so these messages can be forged, as
        ARP's can. Switches defend with RA Guard and ND Inspection; SEND (RFC 3971) signs the messages, but few networks
        use it.
      </p>
    </section>
  </LanSimulator>
```

  6. After the lesson-text section and before `LessonNav`, the addressing note and the comparison:

```astro
  <section class="nd-notes" aria-labelledby="nd-notes-title">
    <h2 id="nd-notes-title">About these addresses</h2>
    <p>
      The game gives each device a short interface ID (::11, ::12, …) so the addresses are easy to read. Real hosts
      pick a stable random ID (RFC 7217) or temporary ones that change (RFC 8981), so their addresses look more like
      2001:db8:0:1:8f3a:21c4:9b7e:5d10.
    </p>
    <div class="table-wrap">
      <table>
        <caption>ARP and Neighbor Discovery side by side</caption>
        <tr><th scope="col"></th><th scope="col">IPv4 ARP</th><th scope="col">IPv6 Neighbor Discovery</th></tr>
        <tr><th scope="row">Who hears the question</th><td>Everyone: a broadcast</td><td>One solicited-node group: multicast</td></tr>
        <tr><th scope="row">Carried in</th><td>Its own EtherType, 0x0806</td><td>ICMPv6 inside IPv6 (EtherType 0x86dd)</td></tr>
        <tr><th scope="row">Cache entries</th><td>Expire after a timeout</td><td>Turn STALE, and are checked when next used</td></tr>
        <tr><th scope="row">Announcing an address</th><td>Gratuitous ARP</td><td>Unsolicited Neighbor Advertisement</td></tr>
        <tr><th scope="row">Catching a duplicate</th><td>Afterwards, when a host sees its own address claimed</td><td>Before use: Duplicate Address Detection</td></tr>
      </table>
    </div>
  </section>
```

  7. The script: `import { startSimulator } from '../../games/nd/controller.js';` and `document.querySelector('[data-nd]')`.
  8. Page CSS: the ARP page's `.notice`, `.lesson-text …`, `.dates` and `h2` rules, plus layout for the two panels and the table (tokens only), e.g. `.nd-fail { display: flex; flex-wrap: wrap; gap: var(--space-2); align-items: center; }`, `.dad-row { display: flex; flex-wrap: wrap; gap: var(--space-2); }`, `.dad-note { font-size: var(--text-sm); }`, `.table-wrap { overflow-x: auto; }`. No base control rules: `.lan-panel` brings them.

- [ ] **Step 6: Run the tests and look at the page**

```bash
npm run build && npx playwright test -g "Neighbor Discovery|/learn/nd|Content Security Policy|Search and AI search"
```

Expected PASS. Then serve the build and take screenshots of `/learn/nd` at 360 px and 1280 px wide, light and dark, into `$S/nd/` (never the repo), after a first ping and in the DAD mode after "Duplicate address". Check by eye: every address fits inside its box, nothing scrolls sideways, the legend colours match the frames, and the "(DAD)" / "duplicate" lines fit. Adjust `LAYOUTS` (box sizes, `addrSize`) if they don't, then re-run the tests.

- [ ] **Step 7: Check and commit**

```bash
npm run format && npm run check
git add src/games/nd src/pages/learn/nd.astro src/content/learn/nd.md src/content/tags.yaml tests/smoke.spec.js
git commit -m "feat(nd): the /learn/nd page: Learn, Sandbox, and DAD and unsolicited NA modes (R18)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Ship it: the course, the share card, the checks and the docs

**Files:**
- Create: `src/games/nd/addresses.test.js`, `public/og/nd.jpg` (generated)
- Modify: `src/content/path.yaml`, `src/site.config.js`, `scripts/make_og_images.mjs`, `scripts/lighthouse.mjs`, `src/pages/learn/nd.astro`, `tests/smoke.spec.js`, `docs/SPEC.md`, `CLAUDE.md`

- [ ] **Step 1: The addressing-rule test** `src/games/nd/addresses.test.js` (the spec's last acceptance item):

```js
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isLinkLocal, parseIpv6 } from './ipv6.js';

const FILES = [
  ...readdirSync('src/games/nd').map((name) => `src/games/nd/${name}`),
  'src/pages/learn/nd.astro',
  'src/content/learn/nd.md',
];
const MAC = /\b(?:[0-9a-f]{2}:){5}[0-9a-f]{2}\b/gi;
const IPV6 = /(?<![\w:])(?:[0-9a-f]{1,4}:){1,7}(?::|[0-9a-f]{1,4})(?::[0-9a-f]{1,4})*(?![\w:])|::(?:[0-9a-f]{1,4}(?::[0-9a-f]{1,4})*)?/gi;

/** @param {string} addr */
function allowed(addr) {
  const b = /** @type {Uint8Array} */ (parseIpv6(addr));
  const documentation = b[0] === 0x20 && b[1] === 0x01 && b[2] === 0x0d && b[3] === 0xb8;
  return documentation || isLinkLocal(addr) || (b[0] === 0xff && b[1] === 0x02) || b.every((x) => x === 0);
}

describe('example addresses (CLAUDE.md, spec section 3)', () => {
  for (const file of FILES) {
    it(`${file} uses only documentation and protocol addresses`, () => {
      const text = readFileSync(file, 'utf8');
      const macs = text.match(MAC) ?? [];
      for (const mac of macs) expect(mac.toLowerCase(), mac).toMatch(/^(00:00:5e:00:53:[0-9a-f]{2}|33:33:[0-9a-f:]{11})$/);
      const withoutMacs = text.replace(MAC, ' ');
      for (const candidate of withoutMacs.match(IPV6) ?? []) {
        if (!parseIpv6(candidate)) continue; // a time, a ratio, a CSS selector: not an address
        expect(allowed(candidate), candidate).toBe(true);
      }
    });
  }
});
```

Run: `npx vitest run src/games/nd/addresses.test.js` — expected PASS. If it flags a real non-documentation address, fix the source, not the test; if it flags something that is not an address but happens to parse, narrow the regex and say why in the report.

- [ ] **Step 2: Place the lesson in the course.** In `src/content/path.yaml`, chapter `finding-your-neighbours` ("Finding your neighbours"), change

```yaml
            - { title: Neighbor Discovery, family: ipv6, kind: game, next: true }
            - { title: 'Try it for real: ARP in Containerlab', family: none, kind: lab }
```

to

```yaml
            - { title: How IPv6 Neighbor Discovery works, family: ipv6, kind: game, entry: nd }
            - { title: 'Try it for real: ARP in Containerlab', family: none, kind: lab, next: true }
```

- [ ] **Step 3: Update the tests that assumed ARP was the only lesson.** Run `npm run build && npx playwright test` and fix each failure that comes from ND now being available and the latest game. Expected:
  - Home's "latest game" (`tests/smoke.spec.js`, around line 565): the link "How IPv6 Neighbor Discovery works" → `/learn/nd`, and Play → `/learn/nd`;
  - Home's Up next (around line 568) and the ARP page's next-lesson text (around line 228): "Neighbor Discovery" becomes the lab, "Try it for real: ARP in Containerlab" (use the exact wording the pages now print);
  - `/learn`'s Part 1 counts (around line 364): "1 available" becomes "2 available";
  - the "Start here" link (around line 386) stays ARP, the first available lesson in course order.

  Change only the expected values that follow from this step; if anything else fails, stop and report it.

- [ ] **Step 4: ND's share card.** In `src/site.config.js`, add `'nd'` to the `shareCards` type and:

```js
  nd: {
    src: '/og/nd.jpg',
    alt: 'How IPv6 Neighbor Discovery works: the simulator’s diagram, with a Neighbor Solicitation flooding from switch SW1 to H2, H3 and R1.',
    width: 1200,
    height: 630,
  },
```

In `scripts/make_og_images.mjs`: rename `arpSnapshot(browser)` to `snapshot(browser, path)` taking the page path (`/learn/arp` or `/learn/nd`), with its doc comment "Photograph a LAN simulator a moment into H1's first flood"; call it for both, and add the card

```js
    {
      name: 'nd',
      title: 'How IPv6 Neighbor Discovery works',
      line: "Play a host on an IPv6 LAN and watch Neighbor Discovery find a neighbor's MAC, with multicast instead of broadcast.",
      art: ndDiagram,
    },
```

(`ndDiagram` built like `diagram`, from `snapshot(browser, '/learn/nd')`). In `src/pages/learn/nd.astro` use `shareCards.nd` for `ogImage` and `image`. Run `npm run og` and look at `public/og/nd.jpg`.

- [ ] **Step 5: Lighthouse.** In `scripts/lighthouse.mjs`, add `'/learn/nd'` to `KEY_PAGES`. Run `npm run lighthouse`: `/learn/nd` must have Performance ≥ 95 and Accessibility 100 (aim for 100s, as `/learn/arp` has).

- [ ] **Step 6: The ARP baseline, one last time.** Build, serve on 4329, run the ARP visual test: 18 passed.

- [ ] **Step 7: Docs.**
  - `docs/SPEC.md`: tick M8's remaining items with "Done <date>: …" notes in the style of earlier milestones; tick section 13's acceptance criteria that now hold; in "Frames", note that the address helpers live in `src/games/nd/ipv6.js` and the encoding in `frames.js`; in "Engine", note the timing rule (timers start after a 4-hop round trip, so "a second apart" shows as 3.4 s of simulated time) and that SW1's MAC table ages at a fixed 60 s (`MAC_AGE_MS`) while the slider sets only the reachable time; add `/learn/nd` to the N1/N3 Lighthouse list if one is spelled out.
  - `CLAUDE.md`, "Current state": add the ND game to **Done**; **Next up** becomes the lab lesson "Try it for real: ARP in Containerlab", marked `next: true` in `path.yaml`; add `npx vitest run src/games/nd/engine.test.js -t "<name>"` beside the ARP one-test example only if the table has room for it, otherwise leave the table alone.

- [ ] **Step 8: Check and commit**

```bash
npm run format && npm run check
git add -A src/games/nd src/content/path.yaml src/site.config.js scripts/make_og_images.mjs scripts/lighthouse.mjs src/pages/learn/nd.astro public/og/nd.jpg tests/smoke.spec.js docs/SPEC.md CLAUDE.md
git commit -m "feat(learn): ship Neighbor Discovery: course entry, share card, checks and docs (R4, R17, R18, N8, N11)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

The branch stays local until the owner says "commit and push".

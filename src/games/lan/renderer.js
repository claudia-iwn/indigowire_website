/**
 * The LAN games' view (spec sections 6 and 13): SVG topology, frames moving along the
 * links, the cache and MAC-table panels, the event log, the packet view and R1's
 * before/after card. Each game passes what differs as a `LanView`.
 *
 * It only subscribes to engine events and reads engine.state; it never changes the
 * simulation. Frames are drawn from the engine's simulated clock: each frame's position
 * is how far it is through its hop, (clock - at) / (arrivesAt - at). So pausing,
 * stepping, changing speed and freezing to inspect need nothing from the view.
 */
import { mountPacketView } from './packet-view.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
export const NEXT_HOP = 'next hop';

/**
 * Where everything sits, for wide screens and phones (portrait). Coordinates are in
 * the SVG's viewBox units, so the drawing scales with its box.
 * @typedef {{ x: number, y: number }} Point
 * @typedef {{ viewBox: string, box: { w: number, h: number }, macSize: number, addrSize?: number, card: 'above' | 'right', places: Record<string, Point> }} Layout
 *   `addrSize`: font size in px for the address lines; the CSS size when unset.
 */
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
 *   A row with `expiresAt` gets a countdown bar in its last cell. The engine's `cache:update`, `cache:stale` and
 *   `cache:expire` payloads are `{ host, ip }`; a row's `key` must equal that `ip`, so the changed row flashes.
 * @property {{ cache: (engine: import('./sim.js').LanEngine) => number, mac: (engine: import('./sim.js').LanEngine) => number }} lifetime
 *   The full length of a countdown, in ms, for the cache rows and the MAC-table rows. Read every frame,
 *   so a slider change shows at once.
 * @property {Record<string, (payload: any) => { host: string, text: string }>} bubbles  Engine event → speech bubble.
 * @property {(hops: any[], nameOf: (mac: string) => string) => import('./hops.js').HopRow[]} hopRows
 * @property {import('./packet-view.js').PacketGame} packet
 */

/** One frame's trip across one link. */
/** @typedef {{ frame: any, from: string, to: string, at: number, arrivesAt: number, el: SVGGElement }} Segment */

/**
 * @template {keyof SVGElementTagNameMap} K
 * @param {K} tag
 * @param {Record<string, string | number>} [attrs]
 * @param {string} [text]
 */
function svg(tag, attrs = {}, text) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, String(value));
  if (text !== undefined) el.textContent = text;
  return el;
}

/**
 * @template {keyof HTMLElementTagNameMap} K
 * @param {K} tag
 * @param {Record<string, string>} [attrs]
 * @param {string} [text]
 */
function html(tag, attrs = {}, text) {
  const el = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
  if (text !== undefined) el.textContent = text;
  return el;
}

/** @param {number} ms */
const seconds = (ms) => `${(ms / 1000).toFixed(1)} s`;

/**
 * Draw the simulation and keep it in step with the engine.
 * @param {{ svg: SVGSVGElement, bubbles: HTMLElement, caches: HTMLElement, macTable: HTMLElement,
 *   log: HTMLOListElement, live: HTMLElement, packet: HTMLElement }} parts
 * @param {import('./sim.js').LanEngine} engine
 * @param {LanView} game
 * @param {{ onInspect?: (frame: any) => void }} [options]
 */
export function mountLanRenderer(parts, engine, game, { onInspect } = {}) {
  const narrow = matchMedia('(width < 40rem)');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  /** @type {Layout} */
  let layout = narrow.matches ? game.layouts.narrow : game.layouts.wide;
  /** @type {Segment[]} */
  let segments = [];
  let you = 'H1';
  const offs = []; // unsubscribe functions, like a list of callbacks to run on teardown

  const linkLayer = svg('g', { class: 'links' });
  const nodeLayer = svg('g', { class: 'nodes' });
  const frameLayer = svg('g', { class: 'frames' });
  const noteLayer = svg('g', { class: 'notes', 'aria-hidden': 'true' });

  /** @param {string} name */
  const place = (name) => layout.places[name];

  /** Draw the links, nodes and next-hop cloud for the current layout. */
  function drawTopology() {
    parts.svg.setAttribute('viewBox', layout.viewBox);
    linkLayer.replaceChildren();
    nodeLayer.replaceChildren();
    const sw = place('SW1');
    const { w, h } = layout.box;

    for (const node of Object.values(engine.state.hosts)) {
      const p = place(node.name);
      const link = svg('g', { class: `link ${node.role}${node.down ? ' down' : ''}` });
      link.append(svg('line', { x1: sw.x, y1: sw.y, x2: p.x, y2: p.y }));
      link.append(
        svg(
          'text',
          { class: 'port', x: sw.x + (p.x - sw.x) * 0.42, y: sw.y + (p.y - sw.y) * 0.42 - 6, 'text-anchor': 'middle' },
          node.port,
        ),
      );
      linkLayer.append(link);
    }
    // R1's upstream link toward the internet.
    const r1 = place('R1');
    const next = place(NEXT_HOP);
    linkLayer.append(svg('line', { class: 'upstream', x1: r1.x, y1: r1.y, x2: next.x, y2: next.y }));

    // Infrastructure: the switch.
    const swGroup = svg('g', { class: 'node infra' });
    swGroup.append(svg('rect', { x: sw.x - 64, y: sw.y - 30, width: 128, height: 60, rx: 8 }));
    swGroup.append(svg('text', { class: 'name', x: sw.x, y: sw.y - 3, 'text-anchor': 'middle' }, 'SW1'));
    swGroup.append(svg('text', { class: 'role', x: sw.x, y: sw.y + 17, 'text-anchor': 'middle' }, 'switch'));
    nodeLayer.append(swGroup);

    // The next hop, drawn as a cloud.
    const cloud = svg('g', { class: 'node cloud' });
    cloud.append(
      svg('path', {
        d: `M${next.x - 46},${next.y + 18} a18,18 0 0 1 4,-34 a24,24 0 0 1 44,-8 a20,20 0 0 1 38,14 a16,16 0 0 1 -6,28 z`,
      }),
    );
    cloud.append(svg('text', { class: 'role', x: next.x + 4, y: next.y + 5, 'text-anchor': 'middle' }, 'next hop'));
    nodeLayer.append(cloud);

    for (const node of Object.values(engine.state.hosts)) {
      const p = place(node.name);
      const infra = node.role === 'gateway';
      const group = svg('g', {
        class: `node ${infra ? 'infra' : 'user'} ${node.role}${node.down ? ' down' : ''}`,
        'data-node': node.name,
      });
      group.append(svg('rect', { x: p.x - w / 2, y: p.y - h / 2, width: w, height: h, rx: 8 }));
      if (!infra) {
        // A small monitor: user devices are where applications run.
        const icon = svg('g', { class: 'icon', transform: `translate(${p.x - w / 2 + 8}, ${p.y - h / 2 + 8})` });
        icon.append(svg('rect', { x: 0, y: 0, width: 16, height: 11, rx: 1.5 }));
        icon.append(svg('path', { d: 'M5 15h6M8 11v4' }));
        group.append(icon);
      }
      const title =
        node.role === 'gateway'
          ? `${node.name} router`
          : node.role === 'attacker'
            ? `${node.name} attacker`
            : node.name;
      group.append(
        svg(
          'text',
          { class: 'name', x: p.x, y: p.y - h / 2 + 22, 'text-anchor': 'middle' },
          node.down ? `${title} (down)` : title,
        ),
      );
      // Address lines under the name (ARP: the IP; ND: global and link-local), then the MAC.
      const lines = game.addressLines(node);
      lines.forEach((text, i) => {
        const line = svg('text', { class: 'addr', x: p.x, y: p.y + 6 + 18 * i, 'text-anchor': 'middle' }, text);
        // Through el.style, as the MAC line below: the CSP blocks style="" attributes.
        if (layout.addrSize) line.style.fontSize = `${layout.addrSize}px`;
        group.append(line);
      });
      const mac = svg(
        'text',
        { class: 'addr mac', x: p.x, y: p.y + 6 + 18 * lines.length, 'text-anchor': 'middle' },
        node.mac,
      );
      // Through el.style, not a style="" attribute: the CSP blocks inline style attributes.
      mac.style.fontSize = `${layout.macSize}px`;
      group.append(mac);
      if (node.name === you) {
        const badge = svg('g', { class: 'you' });
        badge.append(svg('rect', { x: p.x + w / 2 - 40, y: p.y - h / 2 - 11, width: 44, height: 20, rx: 10 }));
        badge.append(svg('text', { x: p.x + w / 2 - 18, y: p.y - h / 2 + 3, 'text-anchor': 'middle' }, 'You'));
        group.append(badge);
      }
      nodeLayer.append(group);
    }
  }

  parts.svg.replaceChildren(linkLayer, nodeLayer, frameLayer, noteLayer);
  drawTopology();

  // ---- Frames on the wire ----

  /** @param {{ frame: any, from: string, to: string, at: number, arrivesAt: number }} hop */
  function addSegment({ frame, from, to, at, arrivesAt }) {
    const kind = game.frameKind(frame);
    const el = svg('g', {
      class: `frame ${kind}`,
      tabindex: 0,
      role: 'button',
      'aria-label': `Inspect ${game.describe(frame)}`,
    });
    el.append(svg('rect', { x: -24, y: -13, width: 48, height: 26, rx: 5 }));
    el.append(svg('text', { y: 5, 'text-anchor': 'middle' }, game.frameLabel(frame)));
    el.addEventListener('click', () => inspect(frame));
    el.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        inspect(frame);
      }
    });
    frameLayer.append(el);
    segments.push({ frame, from, to, at, arrivesAt, el });
  }

  /**
   * @param {number} id
   * @param {string} node
   */
  function removeSegment(id, node) {
    segments = segments.filter((seg) => {
      if (seg.frame?.id === id && seg.to === node) {
        seg.el.remove();
        return false;
      }
      return true;
    });
  }

  /**
   * A short note beside a node that fades away, like "not for me".
   * @param {string} node
   * @param {string} text
   */
  function note(node, text) {
    const p = place(node);
    const el = svg('text', { class: 'note', x: p.x, y: p.y + layout.box.h / 2 + 18, 'text-anchor': 'middle' }, text);
    noteLayer.append(el);
    setTimeout(() => el.remove(), 2000);
  }

  /**
   * Position an overlay at a point on the diagram, kept inside the diagram's edges.
   * @param {HTMLElement} el  Already in parts.bubbles, so it can be measured.
   * @param {Point} point     In viewBox units.
   * @param {'below' | 'above' | 'right'} side
   */
  function placeOverlay(el, point, side) {
    const stage = /** @type {HTMLElement} */ (parts.bubbles.parentElement);
    const [, , vw, vh] = layout.viewBox.split(' ').map(Number);
    const scale = stage.clientWidth / vw;
    const gap = 6;
    // Beside a node, the overlay gets only the room to its right, and wraps to fit.
    if (side === 'right') el.style.maxWidth = `${stage.clientWidth - point.x * scale - 2 * gap}px`;
    const { offsetWidth: w, offsetHeight: h } = el;
    let left = point.x * scale - w / 2;
    let top = side === 'above' ? point.y * scale - h - gap : point.y * scale + gap;
    if (side === 'right') {
      left = point.x * scale + gap;
      top = point.y * scale - h / 2;
    }
    // Like Python's min(max(...)): clamp so the overlay never spills off the diagram.
    el.style.left = `${Math.min(Math.max(gap, left), stage.clientWidth - w - gap)}px`;
    el.style.top = `${Math.min(Math.max(gap, top), vh * scale - h - gap)}px`;
  }

  /**
   * A speech bubble over the diagram, for things worth stopping to read.
   * @param {string} node
   * @param {string} text
   */
  function bubble(node, text) {
    const p = place(node);
    const el = html('div', { class: 'bubble', role: 'note' });
    el.append(html('p', {}, text));
    const close = html('button', { type: 'button', class: 'bubble-close' }, '×');
    close.append(html('span', { class: 'visually-hidden' }, ' Close'));
    close.addEventListener('click', () => el.remove());
    el.append(close);
    parts.bubbles.append(el);
    placeOverlay(el, { x: p.x, y: p.y + layout.box.h / 2 }, 'below');
  }

  /** @type {{ node: string, text: string } | null} The Learn step's note, kept so a layout change can redraw it. */
  let stepNoteShown = null;

  /**
   * Show the Learn step's note beside its device, replacing the last one; null clears it.
   * On wide screens it goes to the right of the hosts in the left column and below the
   * switch or router; on phones, below.
   * @param {{ node: string, text: string } | null} next
   */
  function stepNote(next) {
    stepNoteShown = next;
    parts.bubbles.querySelector('.step-note')?.remove();
    if (!next) return;
    const p = place(next.node);
    const el = html('div', { class: 'step-note', role: 'note' });
    el.append(html('span', { class: 'step-note-node' }, next.node), ' ', next.text);
    parts.bubbles.append(el);
    const leftColumn = p.x < place('SW1').x;
    if (layout === game.layouts.narrow) placeOverlay(el, { x: p.x, y: p.y + layout.box.h / 2 }, 'below');
    else if (leftColumn) placeOverlay(el, { x: p.x + layout.box.w / 2, y: p.y }, 'right');
    // Below and to the right: the open space under R1, clear of the hosts' links.
    else placeOverlay(el, { x: p.x + layout.box.w / 2, y: p.y + layout.box.h / 2 }, 'below');
  }

  // ---- Panels ----

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
        for (const entry of entries) table.append(row('td', entry.values, entry.expiresAt, entry.key, 'cache'));
        section.append(table);
      }
      parts.caches.append(section);
    }
  }

  function drawMacTable() {
    parts.macTable.replaceChildren();
    if (engine.state.switch.macTable.size === 0) {
      parts.macTable.append(html('p', { class: 'empty' }, 'Empty'));
      return;
    }
    const table = html('table');
    table.append(row('th', ['MAC', 'Port', 'Expires']));
    for (const [mac, entry] of engine.state.switch.macTable)
      table.append(row('td', [mac, entry.port, ''], entry.expiresAt, mac, 'mac'));
    parts.macTable.append(table);
  }

  /**
   * One table row. A row with an expiry gets a countdown bar in its last cell.
   * @param {'th' | 'td'} cell
   * @param {string[]} values
   * @param {number} [expiresAt]
   * @param {string} [key]
   * @param {'cache' | 'mac'} [table]  Which countdown length the bar uses (`game.lifetime[table]`).
   */
  function row(cell, values, expiresAt, key, table) {
    const tr = html('tr', key ? { 'data-key': key } : {});
    values.forEach((value, i) => {
      const td = html(cell, cell === 'th' ? { scope: 'col' } : {}, value);
      if (expiresAt !== undefined && i === values.length - 1) {
        td.className = 'expires';
        td.dataset.expiresAt = String(expiresAt);
        if (table) td.dataset.lifetime = table;
        const bar = html('span', { class: 'bar', 'aria-hidden': 'true' });
        bar.append(html('span'));
        td.append(bar, html('span', { class: 'secs' }));
      }
      tr.append(td);
    });
    return tr;
  }

  /**
   * @param {HTMLElement} container
   * @param {string} key
   */
  function flash(container, key) {
    container.querySelector(`tr[data-key="${key}"]`)?.classList.add('changed');
  }

  // ---- Log ----

  /**
   * @param {number} at
   * @param {string} text
   * @param {any} [frame] Adds an Inspect button for this frame.
   */
  function logLine(at, text, frame) {
    const li = html('li', frame ? { class: 'frame-line' } : {});
    li.append(html('span', { class: 'time' }, seconds(at)), ` ${text}`);
    if (frame) {
      const button = html('button', { type: 'button', class: 'inspect' }, 'Inspect');
      button.append(html('span', { class: 'visually-hidden' }, ` ${game.describe(frame)}`));
      button.addEventListener('click', () => inspect(frame));
      li.append(' ', button);
    }
    parts.log.append(li);
    while (parts.log.children.length > 200) parts.log.firstElementChild?.remove();
    parts.log.scrollTop = parts.log.scrollHeight;
    if (!frame) parts.live.textContent = text;
  }

  // ---- Packet view and hop table ----

  /** Every frame:emit, grouped by flow (one send), for the hop table. Like a dict of lists. */
  /** @type {Map<number, any[]>} */
  const flows = new Map();
  /** @type {any} */
  let pinned = null;
  /** @type {any} */
  let shown = null;
  /** @type {any} */
  let latest = null;

  /** @param {string} mac Device name for a MAC, for the hop table. */
  function nameOf(mac) {
    const host = Object.values(engine.state.hosts).find((h) => h.mac === mac);
    if (host) return host.name;
    if (mac === game.upstream.mac) return 'R1 (upstream)';
    if (mac === game.upstream.nextHop.mac) return 'next hop';
    return mac;
  }

  const packetView = mountPacketView(parts.packet, {
    onFollow: () => {
      pinned = null;
      if (latest) showFrame(latest, false);
    },
    game: game.packet,
    hopName: game.hopName,
  });

  /**
   * @param {any} frame
   * @param {boolean} isPinned
   */
  function showFrame(frame, isPinned) {
    shown = frame;
    packetView.show(frame, isPinned);
    packetView.setHops(game.hopRows(flows.get(frame.flow) ?? [], nameOf), frame);
  }

  /** Pin a frame in the packet view; the controller pauses the simulation. */
  /** @param {any} frame */
  function inspect(frame) {
    onInspect?.(frame);
    pinned = frame;
    showFrame(frame, true);
    parts.packet.focus({ preventScroll: true });
    parts.packet.scrollIntoView({ block: 'nearest', behavior: reduce.matches ? 'auto' : 'smooth' });
  }

  /** Before/after cards at R1, shown while the simulated clock is within their window. */
  /** @type {{ el: HTMLElement, from: number, until: number }[]} */
  let rewrites = [];

  /**
   * Show what R1 changed: the old values struck through, the new ones beside them.
   * @param {any} before
   * @param {any} after
   * @param {string} node
   * @param {number} time
   */
  function rewriteCard(before, after, node, time) {
    const p = place(node);
    const el = html('div', { class: 'rewrite', role: 'note' });
    el.append(html('p', { class: 'rewrite-title' }, `${node} rebuilds the frame`));
    const list = html('dl');
    /**
     * @param {string} label
     * @param {string} old
     * @param {string} now
     */
    const change = (label, old, now) => {
      const dd = html('dd');
      if (old === now) dd.append(html('span', {}, `${now} (unchanged)`));
      else dd.append(html('s', {}, old), ' → ', html('span', { class: 'new' }, now));
      list.append(html('dt', {}, label), dd);
    };
    change('Eth dst', nameOf(before.dst), nameOf(after.dst));
    change('Eth src', nameOf(before.src), nameOf(after.src));
    change(game.hopName, String(before.ip.ttl), String(after.ip.ttl));
    change('IP', `${before.ip.src} → ${before.ip.dst}`, `${after.ip.src} → ${after.ip.dst}`);
    el.append(list);
    parts.bubbles.append(el);
    const side = layout.card;
    placeOverlay(
      el,
      side === 'right' ? { x: p.x + layout.box.w / 2, y: p.y } : { x: p.x, y: p.y - layout.box.h / 2 },
      side,
    );
    rewrites.push({ el, from: time, until: time + 3 * game.hopMs });
  }

  // ---- Engine events ----

  offs.push(
    engine.on('frame:emit', (hop) => {
      addSegment(hop);
      const flow = flows.get(hop.frame.flow) ?? [];
      flow.push(hop);
      flows.set(hop.frame.flow, flow);
      if (hop.from !== 'SW1') {
        logLine(hop.at, `${hop.from} sends: ${game.describe(hop.frame)}.`, hop.frame);
        latest = hop.frame;
        if (!pinned) return showFrame(hop.frame, false);
      }
      if (shown?.flow === hop.frame.flow) packetView.setHops(game.hopRows(flow, nameOf), shown);
    }),
    engine.on('frame:arrive', ({ frame, node }) => removeSegment(frame.id, node)),
    engine.on('frame:drop', ({ node, reason }) => note(node, reason)),
    engine.on('frame:forward', ({ frame, out, node, time }) => rewriteCard(frame, out, node, time)),
    engine.on('cache:update', ({ host, ip }) => {
      drawCaches();
      flash(/** @type {HTMLElement} */ (parts.caches.querySelector(`[data-host="${host}"]`)), ip);
    }),
    engine.on('cache:expire', drawCaches),
    engine.on('cache:stale', ({ host, ip }) => {
      drawCaches();
      flash(/** @type {HTMLElement} */ (parts.caches.querySelector(`[data-host="${host}"]`)), ip);
    }),
    // A host's addresses changed (ND's Duplicate Address Detection): redraw its box and cache heading.
    engine.on('host:change', () => {
      drawTopology();
      drawCaches();
    }),
    engine.on('mactable:update', ({ mac }) => {
      drawMacTable();
      flash(parts.macTable, mac);
    }),
    engine.on('mactable:expire', drawMacTable),
    engine.on('host:down', drawTopology),
    engine.on('log', ({ at, text }) => logLine(at, text)),
  );

  // The game's own events that deserve a speech bubble (ARP: no reply, duplicate IP).
  for (const [event, make] of Object.entries(game.bubbles)) {
    offs.push(
      engine.on(event, (payload) => {
        const { host, text } = make(payload);
        bubble(host, text);
      }),
    );
  }

  const onLayout = () => {
    layout = narrow.matches ? game.layouts.narrow : game.layouts.wide;
    drawTopology();
    parts.bubbles.replaceChildren();
    rewrites = [];
    stepNote(stepNoteShown);
  };
  narrow.addEventListener('change', onLayout);

  drawCaches();
  drawMacTable();

  /**
   * Redraw moving parts for the engine's current clock. Call every animation frame.
   */
  function update() {
    const clock = engine.state.clock;
    segments = segments.filter((seg) => {
      const span = seg.arrivesAt - seg.at;
      let t = span > 0 ? Math.min(1, Math.max(0, (clock - seg.at) / span)) : 1;
      // Reduced motion: frames jump between nodes instead of gliding (N4).
      if (reduce.matches) t = t < 0.5 ? 0.15 : 0.85;
      const a = place(seg.from);
      const b = place(seg.to);
      seg.el.setAttribute('transform', `translate(${a.x + (b.x - a.x) * t}, ${a.y + (b.y - a.y) * t})`);
      return true;
    });

    // R1's before/after cards follow the simulated clock, so Pause and Step hold them.
    rewrites = rewrites.filter(({ el, from, until }) => {
      if (clock > until) {
        el.remove();
        return false;
      }
      el.hidden = clock < from;
      return true;
    });

    for (const cell of document.querySelectorAll('[data-expires-at]')) {
      const td = /** @type {HTMLElement} */ (cell);
      const left = Math.max(0, Number(td.dataset.expiresAt) - clock);
      const bar = /** @type {HTMLElement} */ (td.querySelector('.bar > span'));
      bar.style.transform = `scaleX(${Math.min(1, left / game.lifetime[td.dataset.lifetime === 'mac' ? 'mac' : 'cache'](engine))})`;
      const secs = `${Math.ceil(left / 1000)} s`;
      const label = /** @type {HTMLElement} */ (td.querySelector('.secs'));
      if (label.textContent !== secs) label.textContent = secs;
    }
  }

  return {
    update,
    inspect,
    /** @param {string} name Mark the visitor's host. */
    setYou(name) {
      you = name;
      drawTopology();
    },
    /** Redraw the diagram, e.g. after a host takes a new address. */
    redraw: drawTopology,
    stepNote,
    destroy() {
      for (const off of offs) off();
      narrow.removeEventListener('change', onLayout);
      parts.svg.replaceChildren();
      parts.bubbles.replaceChildren();
      parts.log.replaceChildren();
      parts.packet.replaceChildren();
    },
  };
}

/**
 * The packet breakout panel (spec sections 6 and 13), shared by the LAN games: one frame shown as
 *  - a strip of its parts (Ethernet header, inner headers, padding, FCS), coloured by layer,
 *  - its inner header zoomed into 32-bit rows, the way RFCs draw it,
 *  - its bytes as a hex dump, linked to the fields both ways, and
 *  - the hop table: what each device did to the exchange's frames.
 * DOM code; each game supplies its layouts (breakdown) and bytes, which are tested without a browser.
 */
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
 * @property {(frame: any) => string[]} [notes]  Short notes shown under the header rows, e.g. why a field has its value.
 */

/**
 * @param {HTMLElement} panel  The (initially empty) packet panel.
 * @param {{ onFollow: () => void, game: PacketGame, hopName: string }} options  onFollow is called when the visitor goes
 *   back to following the latest frame; hopName heads the hop table's TTL column ('TTL' or 'Hop limit').
 */
export function mountPacketView(panel, { onFollow, game, hopName }) {
  const head = html('div', { class: 'packet-head' });
  const title = html('h2', { id: 'packet-title' }, 'Packet view');
  const status = html('p', { class: 'packet-status' });
  const follow = html('button', { type: 'button', class: 'follow', hidden: '' }, 'Follow the latest frame');
  follow.addEventListener('click', onFollow);
  head.append(title, follow);
  const body = html('div', { class: 'packet-body' });
  const hops = html('div', { class: 'hops' });
  panel.replaceChildren(head, status, body, hops);
  status.textContent = 'Send something: each new frame appears here. Select a frame to pin it.';

  /** Highlight every element linked to one field: strip block, header cell, tree row and bytes. */
  /** @param {string | null} index */
  function highlight(index) {
    for (const el of body.querySelectorAll('[data-field]')) {
      el.classList.toggle('hl', index !== null && /** @type {HTMLElement} */ (el).dataset.field === index);
    }
  }

  /**
   * Show one frame.
   * @param {any} frame
   * @param {boolean} pinned  True when the visitor picked it; false when following the latest frame.
   */
  function show(frame, pinned) {
    const kind = game.kindOf(frame);
    panel.dataset.kind = kind;
    title.textContent = game.describe(frame);
    follow.hidden = !pinned;
    status.textContent = pinned
      ? 'Pinned, and the simulation is paused. Hover or focus any field to see its bytes.'
      : 'Following the latest frame. Select a frame on the diagram, or Inspect in the log, to pin it.';

    const { strip, zoom } = game.breakdown(frame);
    const fields = game.fields(frame);
    const bytes = game.bytes(frame);
    body.replaceChildren();

    // 1. The whole frame as a strip of blocks, widths by byte count.
    const stripEl = html('ol', { class: 'strip', 'aria-label': 'Frame layout' });
    for (const block of strip) {
      const li = html('li', { class: `block ${block.layer}` });
      if (block.field !== undefined) {
        li.dataset.field = String(block.field);
        li.tabIndex = 0;
      }
      // Start from the content's own width, then share the spare room by byte count.
      li.style.flex = `${block.bytes} 1 auto`;
      li.append(html('span', { class: 'label' }, block.label), html('span', { class: 'value' }, block.value));
      li.append(html('span', { class: 'size' }, `${block.bytes} B`));
      stripEl.append(li);
    }
    body.append(stripEl);

    // 2. The inner header in 32-bit rows (grid columns are bits).
    const zoomEl = html('section', { class: `zoom ${zoom.layer}`, 'aria-label': zoom.title });
    zoomEl.append(html('h3', {}, zoom.title));
    const ruler = html('div', { class: 'ruler', 'aria-hidden': 'true' });
    for (const label of ['0', '8', '16', '24', '31']) ruler.append(html('span', {}, label));
    zoomEl.append(ruler);
    const grid = html('div', { class: 'rows' });
    for (const row of zoom.rows) {
      for (const cell of row) {
        const el = html('div', { class: `cell${cell.modelled === false ? ' unmodelled' : ''}` });
        el.style.gridColumn = `span ${Math.min(cell.bits, 32)}`;
        if (cell.field !== undefined) {
          el.dataset.field = String(cell.field);
          el.tabIndex = 0;
        }
        el.append(html('span', { class: 'label' }, cell.name), html('span', { class: 'value' }, cell.value));
        grid.append(el);
      }
    }
    zoomEl.append(grid);
    body.append(zoomEl);

    // 2b. The game's notes on this frame, if any (ND: why the hop limit is 255).
    // `?.` and `??`: call notes only if the game has it, and use [] when it returns nothing.
    const notes = game.notes?.(frame) ?? [];
    if (notes.length) {
      const list = html('ul', { class: 'packet-notes' });
      for (const text of notes) list.append(html('li', {}, text));
      body.append(list);
    }

    // 3. Field tree and hex dump, folded away by default to keep the panel short.
    const details = html('details', { class: 'bytes' });
    details.append(html('summary', {}, game.bytesSummary(frame, bytes)));
    const split = html('div', { class: 'bytes-body' });
    const tree = html('ol', { class: 'fields' });
    fields.forEach((field, i) => {
      const li = html('li', { tabindex: '0', 'data-field': String(i) });
      li.append(html('span', { class: 'field-name' }, `${field.name}: `), html('span', {}, field.value));
      tree.append(li);
    });
    const dump = html('div', { class: 'hexdump', 'aria-label': 'Hex dump' });
    for (let offset = 0; offset < bytes.length; offset += 16) {
      const line = html('div', { class: 'hexrow' });
      line.append(html('span', { class: 'offset' }, offset.toString(16).padStart(4, '0')));
      for (let i = offset; i < Math.min(offset + 16, bytes.length); i++) {
        const index = fields.findIndex((f) => i >= f.offset && i < f.offset + f.length);
        line.append(
          html('span', { class: 'byte', 'data-field': String(index) }, bytes[i].toString(16).padStart(2, '0')),
        );
      }
      dump.append(line);
    }
    split.append(tree, dump);
    details.append(split);
    body.append(details);

    for (const el of body.querySelectorAll('[data-field]')) {
      const index = /** @type {HTMLElement} */ (el).dataset.field ?? null;
      el.addEventListener('pointerenter', () => highlight(index));
      el.addEventListener('pointerleave', () => highlight(null));
      el.addEventListener('focus', () => highlight(index));
      el.addEventListener('blur', () => highlight(null));
    }
  }

  /**
   * Show the hop table for the frame's exchange.
   * @param {import('./hops.js').HopRow[]} rows
   * @param {any} current  The frame on show, whose rows are marked.
   */
  function setHops(rows, current) {
    hops.replaceChildren();
    if (rows.length === 0) return;
    hops.append(html('h3', {}, 'Hop by hop: what each device did'));
    const wrap = html('div', { class: 'table-wrap' });
    const table = html('table');
    const headRow = html('tr');
    for (const name of ['Hop', 'Frame', 'Eth dst', 'Eth src', 'IP src → dst', hopName, 'What happened']) {
      headRow.append(html('th', { scope: 'col' }, name));
    }
    table.append(headRow);
    for (const row of rows) {
      const tr = html('tr', { class: row.kind });
      if (row.frame === current) tr.classList.add('current');
      /** @param {string} text @param {string} [key] */
      const td = (text, key) => {
        const cell = html('td', {}, text);
        if (key && row.changed.includes(/** @type {any} */ (key))) {
          cell.className = 'changed';
          cell.append(html('span', { class: 'visually-hidden' }, ' (changed)'));
        }
        return cell;
      };
      tr.append(
        td(`${row.from} → ${row.to.join(', ')}`),
        td(game.hopFrame(row)),
        td(row.ethDst, 'ethDst'),
        td(row.ethSrc, 'ethSrc'),
        td(row.ip ? `${row.ip.src} → ${row.ip.dst}` : '—'),
        td(row.ip ? String(row.ip.ttl) : '—', 'ttl'),
        td(row.note),
      );
      table.append(tr);
    }
    wrap.append(table);
    hops.append(wrap);
  }

  return { show, setHops };
}

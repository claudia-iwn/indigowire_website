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

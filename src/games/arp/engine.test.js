import { describe, expect, it } from 'vitest';
import { createEngine, TOPOLOGY, HOP_MS, ARP_TIMEOUT_MS } from './engine.js';
import { encodeArpFrame, BROADCAST_MAC, ETHERTYPE_IPV4, MIN_FRAME_BYTES } from './frames.js';

const MAC = Object.fromEntries(TOPOLOGY.nodes.map((n) => [n.name, n.mac])); // name -> MAC

/**
 * Record every event the engine emits, in order.
 * @param {ReturnType<typeof createEngine>} engine
 */
function record(engine) {
  /** @type {{ event: string, payload: any }[]} */
  const seen = [];
  for (const event of /** @type {const} */ ([
    'frame:emit',
    'frame:arrive',
    'frame:drop',
    'frame:forward',
    'cache:update',
    'cache:expire',
    'mactable:update',
    'mactable:expire',
    'arp:timeout',
    'ip:conflict',
    'log',
  ])) {
    engine.on(event, (payload) => seen.push({ event, payload }));
  }
  return {
    seen,
    /** @param {string} event */
    of: (event) => seen.filter((e) => e.event === event).map((e) => e.payload),
  };
}

/** @param {any} frame */
const isArp = (frame) => Boolean(frame.arp);

describe('topology and events', () => {
  it('builds the section 6 topology without the attacker by default', () => {
    const engine = createEngine();
    expect(Object.keys(engine.state.hosts)).toEqual(['H1', 'H2', 'H3', 'R1']);
    expect(engine.state.hosts.H1).toMatchObject({ ip: '192.0.2.11', mac: MAC.H1, port: 'Gi0/1' });
    expect(engine.state.clock).toBe(0);
  });

  it('adds attacker M in Break-it mode', () => {
    expect(createEngine({ attacker: true }).state.hosts.M?.ip).toBe('192.0.2.66');
  });

  it('lets a subscriber unsubscribe', () => {
    const engine = createEngine();
    const seen = [];
    const off = engine.on('log', (payload) => seen.push(payload));
    off();
    engine.send('H1', '192.0.2.12');
    expect(seen).toEqual([]);
  });
});

describe('sending with an empty cache (H1 to 192.0.2.12)', () => {
  it('logs why ARP is needed before any ARP frame', () => {
    const engine = createEngine();
    const rec = record(engine);
    engine.send('H1', '192.0.2.12');
    const first = rec.seen.findIndex((e) => e.event === 'log');
    const firstFrame = rec.seen.findIndex((e) => e.event === 'frame:emit');
    expect(first).toBeGreaterThanOrEqual(0);
    expect(first).toBeLessThan(firstFrame);
    expect(rec.seen[first].payload.text).toMatch(/MAC/);
    expect(rec.seen[first].payload.text).toMatch(/192\.0\.2\.12/);
  });

  it('broadcasts a request that reaches H2, H3 and R1 and drops at H3 and R1', () => {
    const engine = createEngine();
    const rec = record(engine);
    engine.send('H1', '192.0.2.12');
    engine.runUntilIdle();
    const request = rec.of('frame:emit').find((e) => isArp(e.frame) && e.frame.arp.oper === 1).frame;
    expect(request).toMatchObject({
      dst: BROADCAST_MAC,
      src: MAC.H1,
      arp: { tha: '00:00:00:00:00:00', tpa: '192.0.2.12' },
    });
    const reached = rec
      .of('frame:arrive')
      .filter((e) => e.frame.id === request.id)
      .map((e) => e.node);
    expect(reached.sort()).toEqual(['H2', 'H3', 'R1', 'SW1']);
    const dropped = rec
      .of('frame:drop')
      .filter((e) => e.frame.id === request.id)
      .map((e) => e.node);
    expect(dropped.sort()).toEqual(['H3', 'R1']);
  });

  it('answers with a unicast reply to H1 only, then sends the data frame to H2', () => {
    const engine = createEngine();
    const rec = record(engine);
    engine.send('H1', '192.0.2.12');
    engine.runUntilIdle();
    const reply = rec.of('frame:emit').find((e) => isArp(e.frame) && e.frame.arp.oper === 2).frame;
    expect(reply).toMatchObject({ dst: MAC.H1, src: MAC.H2, arp: { sha: MAC.H2, spa: '192.0.2.12', tha: MAC.H1 } });
    const replyReached = rec
      .of('frame:arrive')
      .filter((e) => e.frame.id === reply.id)
      .map((e) => e.node);
    expect(replyReached).toEqual(['SW1', 'H1']);

    const data = rec.of('frame:arrive').filter((e) => e.frame.type === ETHERTYPE_IPV4);
    expect(data.map((e) => e.node)).toEqual(['SW1', 'H2']);
    expect(data[0].frame).toMatchObject({
      dst: MAC.H2,
      src: MAC.H1,
      app: 'ping',
      ip: { src: '192.0.2.11', dst: '192.0.2.12' },
    });
    // The data frame leaves only after the reply has arrived.
    const replyIn = rec.seen.findIndex(
      (e) => e.event === 'frame:arrive' && e.payload.frame.id === reply.id && e.payload.node === 'H1',
    );
    const dataOut = rec.seen.findIndex((e) => e.event === 'frame:emit' && e.payload.frame.type === ETHERTYPE_IPV4);
    expect(replyIn).toBeLessThan(dataOut);
  });

  it('caches each side: H2 learns H1 from the request, H1 learns H2 from the reply', () => {
    const engine = createEngine();
    engine.send('H1', '192.0.2.12');
    engine.runUntilIdle();
    expect(engine.state.hosts.H1.arpCache.get('192.0.2.12')?.mac).toBe(MAC.H2);
    expect(engine.state.hosts.H2.arpCache.get('192.0.2.11')?.mac).toBe(MAC.H1);
    // RFC 826: hosts that were not the target do not add an entry.
    expect(engine.state.hosts.H3.arpCache.size).toBe(0);
  });

  it('labels the data frame with the application that caused the ARP', () => {
    const engine = createEngine();
    const rec = record(engine);
    engine.send('H1', '192.0.2.12', 'web');
    engine.runUntilIdle();
    expect(rec.of('frame:emit').find((e) => !isArp(e.frame)).frame.app).toBe('web');
  });

  it('takes HOP_MS of simulated time per link', () => {
    const engine = createEngine();
    const rec = record(engine);
    engine.send('H1', '192.0.2.12');
    const [first] = rec.of('frame:emit');
    expect(first).toMatchObject({ from: 'H1', to: 'SW1', at: 0, arrivesAt: HOP_MS });
  });
});

describe('the switch', () => {
  it('learns H1 on Gi0/1 after the first frame', () => {
    const engine = createEngine();
    const rec = record(engine);
    engine.send('H1', '192.0.2.12');
    engine.tick(HOP_MS);
    expect(engine.state.switch.macTable.get(MAC.H1)?.port).toBe('Gi0/1');
    expect(rec.of('mactable:update')[0]).toMatchObject({ mac: MAC.H1, port: 'Gi0/1' });
  });

  it('floods unknown unicast and forwards known unicast out one port', () => {
    const engine = createEngine();
    // H1 already knows H2's MAC, but the switch has never seen H2.
    engine.state.hosts.H1.arpCache.set('192.0.2.12', { mac: MAC.H2, expiresAt: 60_000 });
    const rec = record(engine);
    engine.send('H1', '192.0.2.12');
    engine.runUntilIdle();
    const first = rec
      .of('frame:arrive')
      .filter((e) => e.node !== 'SW1')
      .map((e) => e.node);
    expect(first.sort()).toEqual(['H2', 'H3', 'R1']);
    expect(rec.of('frame:drop').map((e) => e.reason)).toEqual(['not for me', 'not for me']);
  });
});

describe('cache hits and aging', () => {
  it('skips ARP entirely when sending again before the TTL expires', () => {
    const engine = createEngine();
    engine.send('H1', '192.0.2.12');
    engine.runUntilIdle();
    const rec = record(engine);
    engine.send('H1', '192.0.2.12');
    engine.runUntilIdle();
    expect(rec.of('frame:emit').some((e) => isArp(e.frame))).toBe(false);
    expect(rec.of('frame:arrive').map((e) => e.node)).toEqual(['SW1', 'H2']);
  });

  it('expires cache and MAC-table entries after the TTL, then ARPs again', () => {
    const engine = createEngine({ ttlMs: 10_000 });
    engine.send('H1', '192.0.2.12');
    engine.runUntilIdle();
    const rec = record(engine);
    engine.tick(10_000);
    expect(rec.of('cache:expire')).toContainEqual({ host: 'H1', ip: '192.0.2.12' });
    expect(rec.of('mactable:expire').map((e) => e.mac)).toContain(MAC.H1);
    expect(engine.state.hosts.H1.arpCache.size).toBe(0);
    engine.send('H1', '192.0.2.12');
    expect(rec.of('frame:emit').some((e) => isArp(e.frame))).toBe(true);
  });

  it('keeps the TTL between 10 and 300 seconds', () => {
    const engine = createEngine();
    engine.setTtl(5_000);
    expect(engine.state.ttlMs).toBe(10_000);
    engine.setTtl(999_000);
    expect(engine.state.ttlMs).toBe(300_000);
  });

  it('queues data sent while ARP is pending and sends one request', () => {
    const engine = createEngine();
    const rec = record(engine);
    engine.send('H1', '192.0.2.12');
    engine.send('H1', '192.0.2.12', 'web');
    engine.runUntilIdle();
    expect(
      rec.of('frame:emit').filter((e) => isArp(e.frame) && e.frame.arp.oper === 1 && e.from === 'H1'),
    ).toHaveLength(1);
    expect(
      rec
        .of('frame:arrive')
        .filter((e) => e.node === 'H2' && !isArp(e.frame))
        .map((e) => e.frame.app),
    ).toEqual(['ping', 'web']);
  });
});

describe('no reply (192.0.2.99)', () => {
  it('times out 1 s after the request reaches every host, without simulating retries', () => {
    const engine = createEngine();
    const rec = record(engine);
    engine.send('H1', '192.0.2.99');
    engine.runUntilIdle();
    const requests = rec.of('frame:emit').filter((e) => isArp(e.frame) && e.from === 'H1');
    expect(requests).toHaveLength(1);
    const lastArrival = Math.max(...rec.of('frame:arrive').map((e) => e.time));
    expect(rec.of('arp:timeout')).toEqual([{ host: 'H1', ip: '192.0.2.99', time: lastArrival + ARP_TIMEOUT_MS }]);
    expect(rec.of('log').at(-1).text).toMatch(/retr/i);
    expect(rec.of('frame:emit').some((e) => !isArp(e.frame))).toBe(false);
  });
});

describe('off-subnet (8.8.8.8)', () => {
  it("resolves R1's MAC, not the destination's", () => {
    const engine = createEngine();
    const rec = record(engine);
    engine.send('H1', '8.8.8.8');
    engine.runUntilIdle();
    const request = rec.of('frame:emit').find((e) => isArp(e.frame)).frame;
    expect(request.arp.tpa).toBe('192.0.2.1');
    expect(rec.of('log')[0].text).toMatch(/gateway/i);
  });

  it("addresses the data frame to R1's MAC with IP destination 8.8.8.8, and R1 forwards it to the next hop", () => {
    const engine = createEngine();
    const rec = record(engine);
    engine.send('H1', '8.8.8.8');
    engine.runUntilIdle();
    const data = rec.of('frame:emit').find((e) => !isArp(e.frame)).frame;
    expect(data).toMatchObject({ dst: MAC.R1, ip: { src: '192.0.2.11', dst: '8.8.8.8' } });
    expect(rec.of('frame:forward')).toEqual([expect.objectContaining({ node: 'R1', to: 'next hop' })]);
    expect(rec.of('log').at(-1).text).toMatch(/next hop/);
  });
});

describe('the inspector', () => {
  it('encodes a request from the engine as exactly 60 bytes', () => {
    const engine = createEngine();
    const rec = record(engine);
    engine.send('H1', '192.0.2.12');
    const request = rec.of('frame:emit')[0].frame;
    expect(encodeArpFrame(request)).toHaveLength(MIN_FRAME_BYTES);
  });
});

describe('Break it', () => {
  it("shows H1's cache entry for 192.0.2.1 changing to M's MAC", () => {
    const engine = createEngine({ attacker: true });
    engine.send('H1', '192.0.2.1');
    engine.runUntilIdle();
    expect(engine.state.hosts.H1.arpCache.get('192.0.2.1')?.mac).toBe(MAC.R1);
    const rec = record(engine);
    engine.spoof('M', 'H1', '192.0.2.1');
    engine.runUntilIdle();
    expect(engine.state.hosts.H1.arpCache.get('192.0.2.1')?.mac).toBe(MAC.M);
    expect(rec.of('cache:update')).toContainEqual(expect.objectContaining({ host: 'H1', ip: '192.0.2.1', mac: MAC.M }));
    // The spoofed reply is unsolicited: H1 never asked.
    expect(rec.of('frame:emit')[0].frame).toMatchObject({
      dst: MAC.H1,
      src: MAC.M,
      arp: { oper: 2, sha: MAC.M, spa: '192.0.2.1' },
    });
  });
});

describe('gratuitous ARP', () => {
  it('broadcasts an announcement with sender IP equal to target IP', () => {
    const engine = createEngine();
    const rec = record(engine);
    engine.announce('H2');
    const frame = rec.of('frame:emit')[0].frame;
    expect(frame).toMatchObject({ dst: BROADCAST_MAC, arp: { oper: 1, spa: '192.0.2.12', tpa: '192.0.2.12' } });
  });

  it('refreshes existing entries on other hosts', () => {
    const engine = createEngine();
    engine.send('H1', '192.0.2.12');
    engine.runUntilIdle();
    engine.tick(30_000);
    engine.announce('H2');
    engine.runUntilIdle();
    expect(engine.state.hosts.H1.arpCache.get('192.0.2.12')?.expiresAt).toBeGreaterThan(60_000);
  });

  it('"Meanwhile, on another host": H3 claims 192.0.2.12, H2 reports a duplicate and caches flip to H3', () => {
    const engine = createEngine();
    engine.send('H1', '192.0.2.12');
    engine.send('R1', '192.0.2.12');
    engine.runUntilIdle();
    const rec = record(engine);
    engine.claimIp('H3', '192.0.2.12');
    engine.runUntilIdle();
    expect(engine.state.hosts.H3.ip).toBe('192.0.2.12');
    expect(rec.of('ip:conflict')).toEqual([expect.objectContaining({ host: 'H2', ip: '192.0.2.12', mac: MAC.H3 })]);
    expect(engine.state.hosts.H1.arpCache.get('192.0.2.12')?.mac).toBe(MAC.H3);
    expect(engine.state.hosts.R1.arpCache.get('192.0.2.12')?.mac).toBe(MAC.H3);
  });
});

describe('stepping', () => {
  it('reports when the next queued action falls due, or null when idle', () => {
    const engine = createEngine();
    expect(engine.nextEventAt()).toBeNull();
    engine.send('H1', '192.0.2.12');
    expect(engine.nextEventAt()).toBe(HOP_MS);
    engine.runUntilIdle();
    expect(engine.nextEventAt()).toBeNull();
  });
});

describe('what each device does to the frame (hop table)', () => {
  it('gives every frame of one send the same flow, and a new send a new flow', () => {
    const engine = createEngine();
    const rec = record(engine);
    engine.send('H1', '192.0.2.12');
    engine.runUntilIdle();
    engine.send('H1', '192.0.2.12');
    engine.runUntilIdle();
    const flows = rec.of('frame:emit').map((e) => e.frame.flow);
    // Request, reply and ping share flow 1; the cached second ping is flow 2.
    expect(new Set(flows.slice(0, -2))).toEqual(new Set([1]));
    expect(flows.at(-1)).toBe(2);
  });

  it('says whether the switch flooded or forwarded each copy, and never changes the frame', () => {
    const engine = createEngine();
    const rec = record(engine);
    engine.send('H1', '192.0.2.12');
    engine.runUntilIdle();
    const fromSwitch = rec.of('frame:emit').filter((e) => e.from === 'SW1');
    expect(fromSwitch.filter((e) => e.frame.arp?.oper === 1).map((e) => e.how)).toEqual(['flood', 'flood', 'flood']);
    expect(fromSwitch.filter((e) => e.frame.arp?.oper === 2).map((e) => e.how)).toEqual(['forward']);
    const inToSwitch = rec.of('frame:emit').find((e) => e.from === 'H1').frame;
    expect(fromSwitch[0].frame).toBe(inToSwitch);
  });

  it('starts data frames with an IP TTL of 64', () => {
    const engine = createEngine();
    const rec = record(engine);
    engine.send('H1', '192.0.2.12');
    engine.runUntilIdle();
    expect(rec.of('frame:emit').find((e) => !isArp(e.frame)).frame.ip.ttl).toBe(64);
  });

  it('has R1 build a new frame for the next link: new MACs, TTL one lower, same IPs', () => {
    const engine = createEngine();
    const rec = record(engine);
    engine.send('H1', '8.8.8.8');
    engine.runUntilIdle();
    const [forward] = rec.of('frame:forward');
    const { upstream } = TOPOLOGY;
    expect(forward.out).toMatchObject({
      src: upstream.mac,
      dst: upstream.nextHop.mac,
      ip: { src: '192.0.2.11', dst: '8.8.8.8', ttl: 63 },
      app: 'ping',
      parent: forward.frame.id,
      flow: forward.frame.flow,
    });
    // The rewritten frame travels on to the next hop like any other.
    const out = rec.of('frame:emit').find((e) => e.frame === forward.out);
    expect(out).toMatchObject({ from: 'R1', to: 'next hop' });
    expect(rec.of('frame:arrive').at(-1)).toMatchObject({ node: 'next hop', frame: forward.out });
  });
});

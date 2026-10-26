import { describe, expect, it } from 'vitest';
import { createEngine, TOPOLOGY, HOP_MS, ARP_TIMEOUT_MS, IP_TTL, INTERNET_HOPS } from './engine.js';
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
    'host:down',
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

    const data = rec.of('frame:arrive').filter((e) => e.frame.type === ETHERTYPE_IPV4 && !e.frame.reply);
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
    const ping = rec.of('frame:emit')[0].frame;
    const first = rec
      .of('frame:arrive')
      .filter((e) => e.node !== 'SW1' && e.frame === ping)
      .map((e) => e.node);
    expect(first.sort()).toEqual(['H2', 'H3', 'R1']);
    const drops = rec.of('frame:drop').filter((e) => e.frame === ping);
    expect(drops.map((e) => e.reason)).toEqual(['not for me', 'not for me']);
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
    // The ping to H2, then H2's echo reply back to H1.
    expect(rec.of('frame:arrive').map((e) => e.node)).toEqual(['SW1', 'H2', 'SW1', 'H1']);
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
    expect(rec.of('frame:forward')[0]).toMatchObject({ node: 'R1', to: 'next hop' });
    expect(rec.of('log').some((e) => /new frame for its upstream link/.test(e.text))).toBe(true);
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
    const first = rec.of('frame:emit').length;
    engine.send('H1', '192.0.2.12');
    engine.runUntilIdle();
    const flows = rec.of('frame:emit').map((e) => e.frame.flow);
    // Request, reply, ping and echo reply share flow 1; the cached second ping and its reply are flow 2.
    expect(new Set(flows.slice(0, first))).toEqual(new Set([1]));
    expect(new Set(flows.slice(first))).toEqual(new Set([2]));
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
    expect(rec.of('frame:arrive')).toContainEqual(expect.objectContaining({ node: 'next hop', frame: forward.out }));
  });
});

describe('replies come back', () => {
  /** @param {any[]} emits */
  const dataHops = (emits) =>
    emits.filter((e) => !isArp(e.frame)).map((e) => `${e.from}→${e.to} ${e.frame.reply ? 'reply' : 'request'}`);

  it('has H2 answer a ping straight away, using the entry it cached from the ARP request', () => {
    const engine = createEngine();
    const rec = record(engine);
    engine.send('H1', '192.0.2.12');
    engine.runUntilIdle();
    expect(dataHops(rec.of('frame:emit'))).toEqual([
      'H1→SW1 request',
      'SW1→H2 request',
      'H2→SW1 reply',
      'SW1→H1 reply',
    ]);
    // H2 learnt H1 from the request, so the reply needs no ARP of its own.
    expect(
      rec
        .of('frame:emit')
        .filter((e) => isArp(e.frame) && e.from === 'H2')
        .map((e) => e.frame.arp.oper),
    ).toEqual([2]);
    const reply = rec.of('frame:emit').find((e) => e.frame.reply).frame;
    expect(reply).toMatchObject({
      dst: MAC.H1,
      src: MAC.H2,
      app: 'ping',
      ip: { src: '192.0.2.12', dst: '192.0.2.11', ttl: IP_TTL },
      flow: 1,
    });
    expect(rec.of('log').at(-1).text).toMatch(/H1 receives the ICMP echo reply from 192\.0\.2\.12/);
  });

  it('answers web and DNS requests with a response of the same application', () => {
    const engine = createEngine();
    const rec = record(engine);
    engine.send('H1', '192.0.2.12', 'dns');
    engine.runUntilIdle();
    expect(rec.of('frame:emit').find((e) => e.frame.reply).frame.app).toBe('dns');
  });

  it('brings the reply from the internet back through R1, which rebuilds the frame for H1', () => {
    const engine = createEngine();
    const rec = record(engine);
    engine.send('H1', '8.8.8.8');
    engine.runUntilIdle();
    expect(dataHops(rec.of('frame:emit'))).toEqual([
      'H1→SW1 request',
      'SW1→R1 request',
      'R1→next hop request',
      'next hop→R1 reply',
      'R1→SW1 reply',
      'SW1→H1 reply',
    ]);
    const forwards = rec.of('frame:forward');
    expect(forwards).toHaveLength(2);
    const back = forwards[1];
    expect(back.frame).toMatchObject({
      src: TOPOLOGY.upstream.nextHop.mac,
      dst: TOPOLOGY.upstream.mac,
      ip: { src: '8.8.8.8', dst: '192.0.2.11', ttl: IP_TTL - INTERNET_HOPS },
    });
    expect(back.out).toMatchObject({
      src: MAC.R1,
      dst: MAC.H1,
      ip: { src: '8.8.8.8', dst: '192.0.2.11', ttl: IP_TTL - INTERNET_HOPS - 1 },
      reply: true,
      parent: back.frame.id,
      flow: 1,
    });
    expect(back).toMatchObject({ node: 'R1', to: 'H1' });
  });

  it('has R1 use ARP on the way back when it no longer knows H1', () => {
    const engine = createEngine();
    engine.send('H1', '8.8.8.8');
    engine.runUntilIdle();
    engine.state.hosts.R1.arpCache.delete('192.0.2.11');
    const rec = record(engine);
    engine.send('H1', '8.8.8.8');
    engine.runUntilIdle();
    const fromR1 = rec.of('frame:emit').filter((e) => e.from === 'R1' && isArp(e.frame));
    expect(fromR1.map((e) => e.frame.arp)).toEqual([expect.objectContaining({ oper: 1, tpa: '192.0.2.11' })]);
    expect(rec.of('frame:arrive').at(-1)).toMatchObject({
      node: 'H1',
      frame: expect.objectContaining({ reply: true }),
    });
  });

  it('has R1 answer a ping to its own address', () => {
    const engine = createEngine();
    const rec = record(engine);
    engine.send('H1', '192.0.2.1');
    engine.runUntilIdle();
    expect(dataHops(rec.of('frame:emit')).slice(-2)).toEqual(['R1→SW1 reply', 'SW1→H1 reply']);
  });

  it('does not answer a reply', () => {
    const engine = createEngine();
    const rec = record(engine);
    engine.send('H1', '192.0.2.12');
    engine.runUntilIdle();
    expect(rec.of('frame:emit').filter((e) => e.frame.reply && e.from !== 'SW1')).toHaveLength(1);
    expect(engine.isIdle()).toBe(true);
  });
});

describe('failover with gratuitous ARP', () => {
  it('primes a cache entry from the topology, as if the hosts had talked earlier', () => {
    const engine = createEngine();
    const rec = record(engine);
    engine.primeCache('H1', '192.0.2.12');
    expect(engine.state.hosts.H1.arpCache.get('192.0.2.12')?.mac).toBe(MAC.H2);
    expect(rec.of('cache:update')).toEqual([expect.objectContaining({ host: 'H1', ip: '192.0.2.12', mac: MAC.H2 })]);
  });

  it('takes a failed host off the network: its port goes down and the switch forgets its MAC', () => {
    const engine = createEngine();
    engine.send('H1', '192.0.2.12');
    engine.runUntilIdle();
    const rec = record(engine);
    engine.fail('H2');
    expect(rec.of('host:down')).toEqual([expect.objectContaining({ host: 'H2' })]);
    expect(engine.state.switch.macTable.has(MAC.H2)).toBe(false);
    engine.announce('H1');
    engine.runUntilIdle();
    expect(
      rec
        .of('frame:emit')
        .filter((e) => e.from === 'SW1')
        .map((e) => e.to),
    ).toEqual(['H3', 'R1']);
  });

  it("lets a standby take over a failed host's address with no duplicate-IP alarm", () => {
    const engine = createEngine();
    engine.primeCache('H1', '192.0.2.12');
    engine.primeCache('R1', '192.0.2.12');
    engine.fail('H2');
    const rec = record(engine);
    engine.claimIp('H3', '192.0.2.12', 'H3, the standby, takes over 192.0.2.12.');
    engine.runUntilIdle();
    expect(rec.of('log')[0].text).toBe('H3, the standby, takes over 192.0.2.12.');
    expect(rec.of('ip:conflict')).toEqual([]);
    expect(engine.state.hosts.H1.arpCache.get('192.0.2.12')?.mac).toBe(MAC.H3);
    expect(engine.state.hosts.R1.arpCache.get('192.0.2.12')?.mac).toBe(MAC.H3);
    // Traffic for 192.0.2.12 now reaches the standby, which answers it.
    const after = record(engine);
    engine.send('H1', '192.0.2.12');
    engine.runUntilIdle();
    expect(
      after
        .of('frame:emit')
        .filter((e) => e.frame.reply)
        .map((e) => e.frame.src)[0],
    ).toBe(MAC.H3);
  });

  it('sends nothing from a failed host', () => {
    const engine = createEngine();
    engine.fail('H2');
    const rec = record(engine);
    engine.send('H2', '192.0.2.11');
    expect(rec.of('frame:emit')).toEqual([]);
    expect(rec.of('log')[0].text).toMatch(/H2 is down/);
  });
});

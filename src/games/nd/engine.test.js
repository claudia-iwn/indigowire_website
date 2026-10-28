import { describe, expect, it } from 'vitest';
import { checkNd, createEngine, HOP_MS, MAX_SOLICIT, RETRANS_MS, ROUND_TRIP_MS, TOPOLOGY } from './engine.js';

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
    'dad:ok',
    'dad:duplicate',
    'host:change',
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
    text: () =>
      seen
        .filter((e) => e.event === 'log')
        .map((e) => e.payload.text)
        .join('\n'),
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
    const fromH2 = r
      .sent()
      .filter((hop) => hop.from === 'H2')
      .map((hop) => hop.frame);
    const reply = fromH2.findIndex((f) => f.reply);
    const check = fromH2.findIndex((f) => f.nd?.type === 135);
    expect(reply).toBeGreaterThan(-1);
    expect(check).toBe(reply + 1);
    expect(fromH2[check]).toMatchObject({
      dst: MAC.H1,
      ip: { src: G2, dst: G1, ttl: 255 },
      nd: { target: G1, lla: MAC.H2 },
    });
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
    expect(
      r
        .sent()
        .slice(before)
        .filter((hop) => hop.frame.nd),
    ).toEqual([]);
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
    expect(
      r
        .sent()
        .slice(before)
        .map((hop) => (hop.frame.nd ? 'NS' : 'ping')),
    ).toEqual(['ping', 'NS']);
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
    expect(r.sent()[0].frame).toMatchObject({
      ip: { src: 'fe80::11', dst: 'ff02::1:ff00:12' },
      nd: { target: 'fe80::12' },
    });
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
  it("R1 solicits from its own address, not from the forwarded packet's far-away source", () => {
    const engine = createEngine();
    const r = record(engine);
    engine.primeCache('H1', 'fe80::1');
    engine.send('H1', '2001:db8:8888::8');
    engine.runUntilIdle();
    const ns = r.sent().find((hop) => hop.from === 'R1' && hop.frame.nd?.type === 135)?.frame;
    expect(ns.ip.src).toBe('2001:db8:0:1::1');
    expect(engine.state.hosts.H1.neighbors.has('2001:db8:8888::8')).toBe(false);
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
    expect(na).toMatchObject({
      dst: '33:33:00:00:00:01',
      ip: { src: G2, dst: 'ff02::1' },
      nd: { solicited: false, override: true, lla: MAC.H3 },
    });
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

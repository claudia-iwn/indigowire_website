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
  for (const event of ['frame:emit', 'frame:arrive', 'frame:forward'])
    sim.on(event, (p) => seen.push({ event, payload: p }));
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

const lanFrame = {
  id: 7,
  dst: '00:00:5e:00:53:01',
  src: '00:00:5e:00:53:11',
  type: 0x0800,
  ip: { src: '192.0.2.11', dst: '8.8.8.8', ttl: 64 },
  app: 'ping',
  flow: 3,
};

describe('createUpstream', () => {
  it('rebuilds a LAN packet for the upstream link, one TTL lower', () => {
    const { state, seen, up } = setup();
    up.forward(R1, lanFrame);
    const fwd = seen.find((e) => e.event === 'frame:forward')?.payload;
    expect(fwd.out).toMatchObject({
      dst: LINK.nextHop.mac,
      src: LINK.mac,
      type: 0x0800,
      ip: { src: '192.0.2.11', dst: '8.8.8.8', ttl: 63 },
      flow: 3,
      parent: 7,
      reply: false,
    });
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
    expect(back.frame).toMatchObject({
      dst: LINK.mac,
      src: LINK.nextHop.mac,
      reply: true,
      flow: 3,
      ip: { src: '8.8.8.8', dst: '192.0.2.11', ttl: 56 },
    });
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
    expect(state.log[0].text).toBe(
      'R1 routes a ping (ICMP echo request) for 8.8.8.8 straight out its upstream link to the next hop.',
    );
    expect(state.log.at(-1)?.text).toBe('R1 receives the ICMP echo reply from 8.8.8.8.');
    expect(toLan).toEqual([]);
  });
});

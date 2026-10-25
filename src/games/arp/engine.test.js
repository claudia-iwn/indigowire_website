import { describe, expect, it } from 'vitest';
import { createEngine, TOPOLOGY } from './engine.js';
import { MIN_FRAME_BYTES } from './frames.js';

describe('ARP engine stub', () => {
  it('builds the section 6 topology without the attacker by default', () => {
    const engine = createEngine();
    expect(Object.keys(engine.state.hosts)).toEqual(['H1', 'H2', 'H3', 'R1']);
    expect(engine.state.hosts.H1).toMatchObject({ ip: '10.0.0.11', mac: '02:00:00:00:00:11', port: 'Gi0/1' });
    expect(engine.state.hosts.R1.ip).toBe('10.0.0.1');
    expect(engine.state.clock).toBe(0);
  });

  it('adds attacker M in Break-it mode', () => {
    expect(createEngine({ attacker: true }).state.hosts.M?.ip).toBe('10.0.0.66');
    expect(TOPOLOGY.nodes).toHaveLength(5);
  });

  it('delivers events to subscribers and advances the simulated clock', () => {
    const engine = createEngine();
    /** @type {unknown[]} */
    const seen = [];
    const off = engine.on('frame:emit', (payload) => seen.push(payload));
    engine.emit('frame:emit', { id: 1 });
    off();
    engine.emit('frame:emit', { id: 2 });
    engine.tick(1500);
    expect(seen).toEqual([{ id: 1 }]);
    expect(engine.state.clock).toBe(1500);
    expect(MIN_FRAME_BYTES).toBe(60);
  });
});

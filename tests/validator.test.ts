import { describe, expect, it } from 'vitest';
import { sampleConfig, sampleMap, sampleRoster } from '../src/core/fixtures';
import { generateValidatedRace, runValidation, type ValidationProgress } from '../src/validate/validator';

describe('validator', () => {
  it('runValidation accepts the sample map', () => {
    const cfg = sampleConfig(12);
    const r = runValidation(sampleMap(12, cfg.marbles.radius), sampleRoster(12), cfg);
    expect(r.ok).toBe(true);
    expect(r.finishers).toBeGreaterThanOrEqual(1);
    expect(r.firstFinishTime).toBeGreaterThan(0);
  });

  it('runValidation rejects an unreachable finish', () => {
    const cfg = sampleConfig(4);
    cfg.race.timeLimit = 5;
    const map = sampleMap(4, cfg.marbles.radius);
    map.finish = { a: { x: -5, y: 500 }, b: { x: 5, y: 500 }, sensor: [] };
    map.bounds.maxY = 600;
    const r = runValidation(map, sampleRoster(4), cfg);
    expect(r.ok).toBe(false);
    expect(r.reason.length).toBeGreaterThan(0);
  });

  it('generateValidatedRace resolves and reports progress', async () => {
    const cfg = sampleConfig(8);
    const phases = new Set<string>();
    const race = await generateValidatedRace(cfg, { onProgress: (p: ValidationProgress) => phases.add(p.phase) });
    expect(race.attempts).toBeGreaterThanOrEqual(1);
    expect(race.seed).toBe((cfg.seed + race.attempts - 1) >>> 0);
    expect(race.validationFinishers).toBeGreaterThanOrEqual(1);
    expect(race.roster.length).toBe(8);
    expect(phases.has('accepted')).toBe(true);
    expect(phases.has('simulating')).toBe(true);
  });

  it('honours AbortSignal', async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(generateValidatedRace(sampleConfig(4), { signal: ac.signal })).rejects.toThrow();
  });

  it('throws when every attempt fails', async () => {
    const cfg = sampleConfig(4);
    cfg.map.maxAttempts = 2;
    cfg.race.minFinishers = 99;
    cfg.race.timeLimit = 3;
    await expect(generateValidatedRace(cfg)).rejects.toThrow(/2 intentos/);
  });
});

describe('requiredFinishers', () => {
  it('never asks for more finishers than marbles or podium places', async () => {
    const { requiredFinishers } = await import('../src/validate/validator');
    const cfg = sampleConfig(1);
    cfg.race.minFinishers = 3;
    expect(requiredFinishers(cfg)).toBe(1);
    const c2 = sampleConfig(20);
    c2.race.minFinishers = 5;
    c2.race.podiumSize = 3;
    c2.race.endMode = 'podium';
    expect(requiredFinishers(c2)).toBe(3);
    c2.race.endMode = 'all';
    expect(requiredFinishers(c2)).toBe(5);
  });
});

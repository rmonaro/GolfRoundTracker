import { describe, expect, it } from 'vitest';
import { buildRotation, defaultConfig, makeRng, proximityYards, scoreShot, zoneFor } from './engine';
import { gappingDrill } from './gapping';
import { targetProximityDrill } from './targetProximity';
import { randomizedRotationDrill } from './randomizedRotation';
import { DRILLS, getDrill } from './registry';
import type { DrillClub, DrillContext, DrillDefinition, RawShot } from './types';

const BAG: DrillClub[] = [
  { label: 'Driver', category: 'driver', carryYards: 250 },
  { label: '7 Iron', category: 'iron', carryYards: 160 },
  { label: 'PW', category: 'wedge', carryYards: 115 }
];

function ctx(config: Record<string, unknown> = {}): DrillContext {
  return { bag: BAG, config };
}
/** Drive a whole drill with a fixed raw shot per step; returns the final state. */
function run(def: DrillDefinition, context: DrillContext, raw: (i: number) => RawShot) {
  let state = def.init(context);
  let i = 0;
  while (!def.isComplete(state) && i < 500) {
    state = def.onShot(raw(i), state, context).nextState;
    i++;
  }
  return state;
}
const flat: RawShot = { carryYards: 150, offlineYards: 0, totalYards: 150, club: null };

// --- engine ---------------------------------------------------------------

describe('engine: proximity + zones', () => {
  it('proximity folds carry error and offline into one distance', () => {
    expect(proximityYards(150, 0, 150)).toBe(0);
    expect(proximityYards(153, 4, 150)).toBeCloseTo(5, 5); // 3-4-5
  });

  it('zones at the 5% / 12% boundaries of the target', () => {
    expect(zoneFor(5, 100)).toBe('great'); // exactly 5%
    expect(zoneFor(5.01, 100)).toBe('good');
    expect(zoneFor(12, 100)).toBe('good'); // exactly 12%
    expect(zoneFor(12.01, 100)).toBe('miss');
    expect(zoneFor(3, 0)).toBeNull(); // no target → no zone
  });

  it('scoreShot lets a user club override the prescription, no target → null zone', () => {
    const { record } = scoreShot({ carryYards: 100, offlineYards: 0, totalYards: 100, club: '5 Iron' }, 'Driver', null);
    expect(record.club).toBe('5 Iron');
    expect(record.prescribedClub).toBe('Driver');
    expect(record.zone).toBeNull();
    expect(record.proximityYards).toBeNull();
  });
});

describe('engine: buildRotation never repeats consecutively', () => {
  it('holds across many seeds with a multi-club set', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const seq = buildRotation(['A', 'B', 'C'], 30, makeRng(seed));
      expect(seq).toHaveLength(30);
      for (let i = 1; i < seq.length; i++) expect(seq[i]).not.toBe(seq[i - 1]);
    }
  });
  it('is deterministic for a given seed', () => {
    expect(buildRotation(['A', 'B', 'C'], 12, makeRng(7))).toEqual(buildRotation(['A', 'B', 'C'], 12, makeRng(7)));
  });
  it('allows repeats only when there is a single club', () => {
    expect(buildRotation(['A'], 5, makeRng(1))).toEqual(['A', 'A', 'A', 'A', 'A']);
  });
});

// --- registry seam ---------------------------------------------------------

describe('registry', () => {
  it('exposes the three v1 drills and resolves by id', () => {
    expect(DRILLS.map((d) => d.id)).toEqual(['gapping', 'target-proximity', 'randomized-rotation']);
    expect(getDrill('gapping')).toBe(gappingDrill);
    expect(getDrill('nope')).toBeNull();
  });
  it('every drill satisfies the definition contract (the seam)', () => {
    for (const d of DRILLS) {
      const c = ctx(defaultConfig(d.setupSchema, BAG));
      const s = d.init(c);
      expect(s.current).not.toBeNull();
      expect(typeof d.usesTargets(c.config)).toBe('boolean');
      const final = run(d, c, () => flat);
      expect(d.isComplete(final)).toBe(true);
      expect(d.report(final, c).headline.value).toBeTruthy();
    }
  });
});

// --- Gapping ---------------------------------------------------------------

describe('Gapping', () => {
  it('walks every club shotsPerClub times and reports a carry ladder', () => {
    const c = ctx({ clubs: ['Driver', '7 Iron', 'PW'], shotsPerClub: 3 });
    expect(gappingDrill.usesTargets(c.config)).toBe(false);
    let state = gappingDrill.init(c);
    expect(state.current?.totalShots).toBe(9);
    expect(state.current?.club).toBe('Driver');
    // Give each club a distinct carry so the ladder ordering is checkable.
    const carryByStep = [250, 250, 250, 160, 160, 160, 115, 115, 115];
    let i = 0;
    while (!gappingDrill.isComplete(state)) {
      state = gappingDrill.onShot({ carryYards: carryByStep[i], offlineYards: 0, totalYards: carryByStep[i], club: null }, state, c).nextState;
      i++;
    }
    expect(state.shotsLogged).toHaveLength(9);
    const report = gappingDrill.report(state, c);
    const ladder = report.data.ladder as Array<{ club: string; avgCarry: number }>;
    expect(ladder.map((r) => r.club)).toEqual(['Driver', '7 Iron', 'PW']); // long → short
    const flags = report.data.flags as Array<{ kind: string }>;
    expect(flags.some((f) => f.kind === 'gap')).toBe(true); // 250→160→115 are all >15 apart
  });
});

// --- Target Proximity ------------------------------------------------------

describe('Target Proximity', () => {
  it('scores each shot by distance from the intended point and zones it', () => {
    const c = ctx({ clubs: ['7 Iron'], shotCount: 4, callClub: true, targetSource: 'gapped', seed: 3 });
    let state = targetProximityDrill.init(c);
    expect(state.current?.targetYards).toBe(160); // 7 Iron gapped carry
    // Land exactly on the number → great; then 30 short → miss.
    const res1 = targetProximityDrill.onShot({ carryYards: 160, offlineYards: 0, totalYards: 160, club: null }, state, c);
    expect(res1.result.zone).toBe('great');
    expect(res1.result.proximityYards).toBeCloseTo(0, 5);
    state = res1.nextState;
    const res2 = targetProximityDrill.onShot({ carryYards: 130, offlineYards: 0, totalYards: 130, club: null }, state, c);
    expect(res2.result.zone).toBe('miss');
    expect(res2.result.proximityYards).toBeCloseTo(30, 5);
  });

  it('completes after shotCount shots and headlines avg proximity', () => {
    const c = ctx({ clubs: ['7 Iron'], shotCount: 5, seed: 1 });
    const final = run(targetProximityDrill, c, () => flat);
    expect(final.shotsLogged).toHaveLength(5);
    expect(targetProximityDrill.report(final, c).headline.label).toBe('Avg proximity');
  });
});

// --- Randomized Rotation ---------------------------------------------------

describe('Randomized Rotation', () => {
  it('never calls the same club twice in a row', () => {
    const c = ctx({ clubs: ['Driver', '7 Iron', 'PW'], shotCount: 24, seed: 5 });
    const seq: string[] = [];
    let state = randomizedRotationDrill.init(c);
    while (!randomizedRotationDrill.isComplete(state)) {
      seq.push(state.current!.club!);
      state = randomizedRotationDrill.onShot(flat, state, c).nextState;
    }
    expect(seq).toHaveLength(24);
    for (let i = 1; i < seq.length; i++) expect(seq[i]).not.toBe(seq[i - 1]);
  });

  it('dispersion-only by default; proximity when targets enabled', () => {
    const noTargets = ctx({ clubs: ['Driver', '7 Iron'], shotCount: 6, seed: 2 });
    expect(randomizedRotationDrill.usesTargets(noTargets.config)).toBe(false);
    expect(randomizedRotationDrill.report(run(randomizedRotationDrill, noTargets, () => flat), noTargets).headline.label).toBe('Overall dispersion');

    const withTargets = ctx({ clubs: ['Driver', '7 Iron'], shotCount: 6, includeTargets: true, seed: 2 });
    expect(randomizedRotationDrill.usesTargets(withTargets.config)).toBe(true);
    const final = run(randomizedRotationDrill, withTargets, () => flat);
    expect(randomizedRotationDrill.report(final, withTargets).headline.label).toBe('Avg proximity');
  });
});

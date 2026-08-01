// Pure helpers shared by drill definitions: setup defaults, proximity scoring,
// caddie notes, deterministic RNG, and the no-repeat rotation builder. No geo,
// no I/O — keeps every drill trivially unit-testable.

import type { DrillClub, RawShot, SetupField, ShotRecord, ShotZone } from './types';

// --- setup config ----------------------------------------------------------

/** Build the initial config object from a setup schema's defaults. */
export function defaultConfig(schema: SetupField[], bag: DrillClub[]): Record<string, unknown> {
  const cfg: Record<string, unknown> = {};
  for (const f of schema) {
    if (f.kind === 'clubs') {
      cfg[f.key] = f.default === 'fullBag' ? bag.map((c) => c.label) : [];
    } else {
      cfg[f.key] = f.default;
    }
  }
  return cfg;
}

// --- scoring ---------------------------------------------------------------

/**
 * Planar proximity (yards) in the target-line frame: the intended point sits at
 * (carry = targetYards, offline = 0), so distance folds carry error + offline
 * into one number. Equivalent to a geodesic distance at range scale, without geo.
 */
export function proximityYards(carryYards: number, offlineYards: number, targetYards: number): number {
  const dCarry = carryYards - targetYards;
  return Math.hypot(dCarry, offlineYards);
}

/** Zone by proximity: great ≤ 5% of the target distance, good ≤ 12%, else miss. */
export function zoneFor(proximity: number, targetYards: number): ShotZone {
  if (!targetYards || targetYards <= 0) return null;
  if (proximity <= 0.05 * targetYards) return 'great';
  if (proximity <= 0.12 * targetYards) return 'good';
  return 'miss';
}

const cap = (s: string): string => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** Short caddie line, e.g. "3 yds long, 6 right" or "Flushed it, dead straight". */
export function caddieNote(record: Pick<ShotRecord, 'carryYards' | 'offlineYards' | 'targetYards'>): string {
  const parts: string[] = [];
  if (record.targetYards != null) {
    const d = Math.round(record.carryYards - record.targetYards);
    if (Math.abs(d) <= 2) parts.push('perfect distance');
    else parts.push(`${Math.abs(d)} yds ${d > 0 ? 'long' : 'short'}`);
  } else {
    parts.push(`${Math.round(record.carryYards)} yds`);
  }
  const off = Math.round(record.offlineYards);
  if (Math.abs(off) <= 2) parts.push('dead straight');
  else parts.push(`${Math.abs(off)} ${off > 0 ? 'right' : 'left'}`);
  return cap(parts.join(', '));
}

/** Build a scored ShotRecord from a raw tap + the prescription it answered. */
export function scoreShot(
  raw: RawShot,
  prescribedClub: string | null,
  targetYards: number | null
): { record: ShotRecord; note: string } {
  const club = raw.club ?? prescribedClub;
  const prox = targetYards != null ? proximityYards(raw.carryYards, raw.offlineYards, targetYards) : null;
  const zone = prox != null && targetYards != null ? zoneFor(prox, targetYards) : null;
  const record: ShotRecord = {
    club,
    prescribedClub,
    targetYards,
    carryYards: raw.carryYards,
    offlineYards: raw.offlineYards,
    totalYards: raw.totalYards,
    proximityYards: prox,
    zone
  };
  return { record, note: caddieNote(record) };
}

// --- stats -----------------------------------------------------------------

export const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

export function stdDev(xs: number[]): number {
  if (xs.length === 0) return 0;
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
}

// --- deterministic RNG (so rotation sequences are reproducible/testable) ----

/** Mulberry32: tiny seeded PRNG → () => float in [0,1). */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A rotation of `n` club labels drawn from `clubs`, never repeating the same
 * club twice in a row (unless there's only one club). Deterministic given seed.
 */
export function buildRotation(clubs: string[], n: number, rng: () => number): string[] {
  const seq: string[] = [];
  if (clubs.length === 0) return seq;
  for (let i = 0; i < n; i++) {
    let pick = clubs[Math.floor(rng() * clubs.length)];
    let guard = 0;
    while (clubs.length > 1 && pick === seq[i - 1] && guard < 64) {
      pick = clubs[Math.floor(rng() * clubs.length)];
      guard++;
    }
    seq.push(pick);
  }
  return seq;
}

// --- club helpers ----------------------------------------------------------

const DEFAULT_CARRY_BY_CATEGORY: Record<string, number> = {
  driver: 230,
  wood: 210,
  hybrid: 195,
  iron: 165,
  wedge: 110,
  putter: 0
};

/** A sensible target carry for a club when the bag has no measured distance. */
export function carryForClub(club: DrillClub): number {
  if (club.carryYards != null && club.carryYards > 0) return club.carryYards;
  return DEFAULT_CARRY_BY_CATEGORY[club.category] ?? 150;
}

/** Look up a DrillClub by its label. */
export function findClub(bag: DrillClub[], label: string | null): DrillClub | null {
  if (!label) return null;
  return bag.find((c) => c.label === label) ?? null;
}

/** Resolve the configured club labels to DrillClubs, preserving bag order. */
export function selectedClubs(bag: DrillClub[], labels: unknown): DrillClub[] {
  const set = new Set(Array.isArray(labels) ? (labels as string[]) : []);
  const chosen = bag.filter((c) => set.has(c.label));
  return chosen.length ? chosen : bag;
}

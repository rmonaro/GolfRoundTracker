// Randomized Rotation — transfer drill (the differentiator). The app calls a
// different club every shot, never the same one twice in a row, so the golfer
// can't groove one club. Interleaved practice transfers to the course far better
// than blocked practice. Optionally calls a target distance per shot too.

import type { CurrentShot, DrillContext, DrillDefinition, DrillState, ShotRecord } from './types';
import { buildRotation, carryForClub, findClub, makeRng, mean, scoreShot, selectedClubs, stdDev } from './engine';

const CLUBS = 'clubs';
const SHOT_COUNT = 'shotCount';
const INCLUDE_TARGETS = 'includeTargets';

interface RotationRow {
  club: string;
  shots: number;
  avgCarry: number;
  dispersion: number;
  avgProximity: number | null;
}

function usesTargets(config: Record<string, unknown>): boolean {
  return config[INCLUDE_TARGETS] === true;
}

function currentFor(state: DrillState, ctx: DrillContext): CurrentShot | null {
  const total = Number(ctx.config[SHOT_COUNT]) || 12;
  const index = state.shotsLogged.length;
  if (index >= total) return null;
  const clubSeq = state.scratch.clubSeq as string[];
  const targetSeq = state.scratch.targetSeq as Array<number | null>;
  const club = clubSeq[index] ?? null;
  const target = targetSeq[index] ?? null;
  return {
    club,
    targetYards: target,
    instruction: target != null ? `Hit your ${club} to ${target} yds` : `Hit your ${club}`,
    shotNumber: index + 1,
    totalShots: total
  };
}

export const randomizedRotationDrill: DrillDefinition = {
  id: 'randomized-rotation',
  name: 'Randomized Rotation',
  category: 'transfer',
  blurb: 'The app calls a different club every shot. No raking.',
  why: 'Interleaved practice feels harder but transfers to the course far better than hitting one club over and over.',
  setupSchema: [
    { kind: 'clubs', key: CLUBS, label: 'Clubs in rotation', default: 'fullBag' },
    { kind: 'number', key: SHOT_COUNT, label: 'Shots', default: 12, min: 4, max: 40 },
    { kind: 'toggle', key: INCLUDE_TARGETS, label: 'Call a target distance too', help: 'Score proximity, not just dispersion.', default: false }
  ],
  usesTargets,

  init(ctx) {
    const clubs = selectedClubs(ctx.bag, ctx.config[CLUBS]);
    const total = Number(ctx.config[SHOT_COUNT]) || 12;
    const rng = makeRng(Number(ctx.config.seed) || 1);
    const labels = clubs.map((c) => c.label);
    const clubSeq = buildRotation(labels, total, rng);
    const withTargets = usesTargets(ctx.config);
    const targetSeq: Array<number | null> = clubSeq.map((label) => {
      if (!withTargets) return null;
      const club = findClub(ctx.bag, label);
      return club ? Math.round(carryForClub(club)) : null;
    });
    const state: DrillState = { shotsLogged: [], current: null, scratch: { clubSeq, targetSeq } };
    state.current = currentFor(state, ctx);
    return state;
  },

  onShot(raw, state, ctx) {
    const cur = state.current;
    const { record, note } = scoreShot(raw, cur?.club ?? null, cur?.targetYards ?? null);
    const shotsLogged = [...state.shotsLogged, record];
    const next: DrillState = { ...state, shotsLogged };
    next.current = currentFor(next, ctx);
    return {
      result: {
        carryYards: record.carryYards,
        offlineYards: record.offlineYards,
        proximityYards: record.proximityYards,
        zone: record.zone,
        note
      },
      nextState: next
    };
  },

  isComplete(state) {
    return state.current === null;
  },

  report(state, ctx) {
    const withTargets = usesTargets(ctx.config);
    const order: string[] = [];
    const byClub = new Map<string, ShotRecord[]>();
    for (const s of state.shotsLogged) {
      const key = s.club ?? 'Unspecified';
      if (!byClub.has(key)) {
        byClub.set(key, []);
        order.push(key);
      }
      byClub.get(key)!.push(s);
    }
    const rows: RotationRow[] = order.map((club) => {
      const list = byClub.get(club)!;
      const prox = list.map((s) => s.proximityYards).filter((v): v is number => v != null);
      return {
        club,
        shots: list.length,
        avgCarry: mean(list.map((s) => s.carryYards)),
        dispersion: stdDev(list.map((s) => s.offlineYards)),
        avgProximity: prox.length ? mean(prox) : null
      };
    });

    let headline: { label: string; value: string };
    if (withTargets) {
      const allProx = state.shotsLogged.map((s) => s.proximityYards).filter((v): v is number => v != null);
      headline = { label: 'Avg proximity', value: allProx.length ? `${Math.round(mean(allProx))}y` : '—' };
    } else {
      const allOff = state.shotsLogged.map((s) => s.offlineYards);
      headline = { label: 'Overall dispersion', value: allOff.length ? `±${Math.round(stdDev(allOff))}y` : '—' };
    }

    // Best (tightest) and most fragile club under rotation.
    const metric = (r: RotationRow) => (withTargets && r.avgProximity != null ? r.avgProximity : r.dispersion);
    const ranked = [...rows].filter((r) => r.shots > 0).sort((a, b) => metric(a) - metric(b));
    return {
      headline,
      stats: [
        { label: 'Clubs', value: `${rows.length}` },
        { label: 'Shots', value: `${state.shotsLogged.length}` },
        ranked.length ? { label: 'Held up best', value: ranked[0].club } : { label: 'Held up best', value: '—' },
        ranked.length > 1 ? { label: 'Fell apart most', value: ranked[ranked.length - 1].club } : { label: 'Fell apart most', value: '—' }
      ],
      kind: 'rotation',
      data: { rows, withTargets }
    };
  }
};

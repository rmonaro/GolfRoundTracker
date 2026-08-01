// Gapping — foundation drill. Walk the bag in order, a few shots per club, and
// measure true carry per club. No targets; just carry + dispersion. The report
// is a carry ladder that flags gaps (>15 yd) and overlaps (adjacent clubs within
// ~5 yd or out of order), and can seed the bag's typical-distance carry profile.

import type { CurrentShot, DrillDefinition, DrillState, ShotRecord } from './types';
import { mean, scoreShot, selectedClubs, stdDev } from './engine';

const SHOTS_PER_CLUB = 'shotsPerClub';
const CLUBS = 'clubs';

interface LadderRow {
  club: string;
  shots: number;
  avgCarry: number;
  dispersion: number;
}
interface LadderFlag {
  kind: 'gap' | 'overlap';
  from: string;
  to: string;
  yards: number;
}

function buildQueue(state: DrillState): string[] {
  return (state.scratch.queue as string[]) ?? [];
}

function currentFor(queue: string[], index: number): CurrentShot | null {
  if (index >= queue.length) return null;
  return {
    club: queue[index],
    targetYards: null,
    instruction: `Hit your ${queue[index]}`,
    shotNumber: index + 1,
    totalShots: queue.length
  };
}

export const gappingDrill: DrillDefinition = {
  id: 'gapping',
  name: 'Gapping',
  category: 'foundation',
  blurb: 'Learn your real carry for every club.',
  why: "Most golfers don't know their true gaps — this builds the baseline every other drill uses.",
  setupSchema: [
    { kind: 'clubs', key: CLUBS, label: 'Clubs', help: 'Walked in bag order.', default: 'fullBag' },
    { kind: 'number', key: SHOTS_PER_CLUB, label: 'Shots per club', default: 4, min: 1, max: 10 }
  ],
  usesTargets: () => false,

  init(ctx) {
    const clubs = selectedClubs(ctx.bag, ctx.config[CLUBS]);
    const per = Number(ctx.config[SHOTS_PER_CLUB]) || 4;
    const queue: string[] = [];
    for (const c of clubs) for (let i = 0; i < per; i++) queue.push(c.label);
    return { shotsLogged: [], current: currentFor(queue, 0), scratch: { queue } };
  },

  onShot(raw, state) {
    const queue = buildQueue(state);
    const index = state.shotsLogged.length;
    const { record, note } = scoreShot(raw, queue[index] ?? null, null);
    const shotsLogged = [...state.shotsLogged, record];
    return {
      result: {
        carryYards: record.carryYards,
        offlineYards: record.offlineYards,
        proximityYards: null,
        zone: null,
        note
      },
      nextState: { ...state, shotsLogged, current: currentFor(queue, shotsLogged.length) }
    };
  },

  isComplete(state) {
    return state.shotsLogged.length >= buildQueue(state).length;
  },

  report(state) {
    // Per-club averages, in the order each club first appears (bag order).
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
    const rows: LadderRow[] = order.map((club) => {
      const list = byClub.get(club)!;
      return {
        club,
        shots: list.length,
        avgCarry: mean(list.map((s) => s.carryYards)),
        dispersion: stdDev(list.map((s) => s.offlineYards))
      };
    });
    // Ladder sorted long → short for gap/overlap analysis.
    const ladder = [...rows].sort((a, b) => b.avgCarry - a.avgCarry);
    const flags: LadderFlag[] = [];
    for (let i = 0; i < ladder.length - 1; i++) {
      const gap = ladder[i].avgCarry - ladder[i + 1].avgCarry;
      if (gap > 15) flags.push({ kind: 'gap', from: ladder[i].club, to: ladder[i + 1].club, yards: Math.round(gap) });
      else if (gap < 5) flags.push({ kind: 'overlap', from: ladder[i].club, to: ladder[i + 1].club, yards: Math.round(gap) });
    }
    const longest = ladder[0];
    return {
      headline: longest
        ? { label: `${longest.club} carry`, value: `${Math.round(longest.avgCarry)}y` }
        : { label: 'Carry', value: '—' },
      stats: [
        { label: 'Clubs measured', value: `${rows.length}` },
        { label: 'Shots', value: `${state.shotsLogged.length}` },
        { label: 'Gaps / overlaps flagged', value: `${flags.length}` }
      ],
      kind: 'gapping',
      data: { ladder, flags }
    };
  }
};

// Target Proximity — skill drill. The app calls a number (and optionally a club);
// each shot is scored by how close it landed to that intended distance. Trains
// distance control, the core on-course skill.

import type { CurrentShot, DrillContext, DrillDefinition, DrillState } from './types';
import { buildRotation, carryForClub, findClub, makeRng, mean, scoreShot, selectedClubs } from './engine';

const CLUBS = 'clubs';
const SHOT_COUNT = 'shotCount';
const CALL_CLUB = 'callClub';
const TARGET_SOURCE = 'targetSource';
const MIN_YDS = 'minYards';
const MAX_YDS = 'maxYards';

function currentFor(state: DrillState, ctx: DrillContext): CurrentShot | null {
  const total = Number(ctx.config[SHOT_COUNT]) || 10;
  const index = state.shotsLogged.length;
  if (index >= total) return null;
  const clubSeq = state.scratch.clubSeq as Array<string | null>;
  const targetSeq = state.scratch.targetSeq as number[];
  const club = clubSeq[index] ?? null;
  const target = targetSeq[index];
  return {
    club,
    targetYards: target,
    instruction: club ? `Hit your ${club} to ${target} yds` : `Hit any club to ${target} yds`,
    shotNumber: index + 1,
    totalShots: total
  };
}

export const targetProximityDrill: DrillDefinition = {
  id: 'target-proximity',
  name: 'Target Proximity',
  category: 'skill',
  blurb: 'Hit a called number. Score how close.',
  why: 'Trains distance control to a specific target, the core on-course skill.',
  setupSchema: [
    { kind: 'clubs', key: CLUBS, label: 'Clubs', default: 'fullBag' },
    { kind: 'number', key: SHOT_COUNT, label: 'Shots', default: 10, min: 4, max: 40 },
    { kind: 'toggle', key: CALL_CLUB, label: 'App picks the club', help: 'Off = you choose the club, app calls only the number.', default: true },
    {
      kind: 'select',
      key: TARGET_SOURCE,
      label: 'Target distances',
      default: 'gapped',
      options: [
        { value: 'gapped', label: 'My carry distances' },
        { value: 'random', label: 'Random in a range' }
      ]
    },
    { kind: 'number', key: MIN_YDS, label: 'Min yards (random)', default: 80, min: 20, max: 320 },
    { kind: 'number', key: MAX_YDS, label: 'Max yards (random)', default: 180, min: 20, max: 350 }
  ],
  usesTargets: () => true,

  init(ctx) {
    const clubs = selectedClubs(ctx.bag, ctx.config[CLUBS]);
    const total = Number(ctx.config[SHOT_COUNT]) || 10;
    const callClub = ctx.config[CALL_CLUB] !== false;
    const source = (ctx.config[TARGET_SOURCE] as string) ?? 'gapped';
    const min = Number(ctx.config[MIN_YDS]) || 80;
    const max = Math.max(min, Number(ctx.config[MAX_YDS]) || 180);
    const rng = makeRng(Number(ctx.config.seed) || 1);

    const labels = clubs.map((c) => c.label);
    const clubSeq: Array<string | null> = callClub ? buildRotation(labels, total, rng) : Array(total).fill(null);
    const targetSeq: number[] = [];
    for (let i = 0; i < total; i++) {
      if (source === 'gapped' && callClub) {
        const club = findClub(ctx.bag, clubSeq[i]);
        targetSeq.push(club ? Math.round(carryForClub(club)) : Math.round(min + rng() * (max - min)));
      } else {
        // Random target rounded to the nearest 5 yds.
        targetSeq.push(Math.round((min + rng() * (max - min)) / 5) * 5);
      }
    }
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

  report(state) {
    const shots = state.shotsLogged;
    const prox = shots.map((s) => s.proximityYards ?? 0);
    const great = shots.filter((s) => s.zone === 'great').length;
    const good = shots.filter((s) => s.zone === 'good').length;
    const lr = mean(shots.map((s) => s.offlineYards));
    const sl = mean(shots.map((s) => (s.targetYards != null ? s.carryYards - s.targetYards : 0)));
    const best = shots.length ? Math.min(...prox) : 0;
    const avg = mean(prox);
    const pct = (n: number) => (shots.length ? Math.round((100 * n) / shots.length) : 0);
    return {
      headline: { label: 'Avg proximity', value: shots.length ? `${Math.round(avg)}y` : '—' },
      stats: [
        { label: 'Best shot', value: shots.length ? `${Math.round(best)}y` : '—' },
        { label: 'In great / good', value: `${pct(great)}% / ${pct(good)}%` },
        { label: 'Side bias', value: `${Math.abs(Math.round(lr))}y ${lr >= 0 ? 'right' : 'left'}` },
        { label: 'Distance bias', value: `${Math.abs(Math.round(sl))}y ${sl >= 0 ? 'long' : 'short'}` }
      ],
      kind: 'proximity',
      data: {
        scatter: shots.map((s) => ({
          dCarry: s.targetYards != null ? s.carryYards - s.targetYards : 0,
          offline: s.offlineYards,
          zone: s.zone
        })),
        greatPct: pct(great),
        goodPct: pct(good)
      }
    };
  }
};

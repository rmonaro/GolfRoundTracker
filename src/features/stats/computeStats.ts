import dayjs from 'dayjs';
import type { Round, Shot } from '@/models';
import { estimateHandicap, type HandicapResult } from '@/utils/handicap';

export interface AggregatedStats {
  handicap: HandicapResult;
  bestScore: number | null;
  bestRound: Round | null;
  averageScore: number | null;
  averageScoreVsPar: number | null;
  fairwaysHitPct: number | null;
  girPct: number | null;
  puttsPerRound: number | null;
  penaltyAverage: number | null;
  missBias: 'left' | 'right' | 'balanced' | null;
  recentScores: Array<{ date: string; score: number; vsPar: number }>;
  handicapTrend: Array<{ date: string; differential: number | null }>;
  recentDifferentials: Array<{ date: string; differential: number | null }>;
}

export function aggregateRoundStats(
  rounds: Round[],
  holesByRound: Map<string, Array<{ fairway_result: string | null; putts: number; gir: boolean; penalty_strokes: number }>>
): AggregatedStats {
  const completedRounds = rounds.filter((r) => r.completed_at);
  const completed = completedRounds.sort(
    (a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime()
  );

  const recent = completed.slice(0, 20);
  const handicap = estimateHandicap(recent.map((r) => r.handicap_differential));

  let bestScore: number | null = null;
  let bestRound: Round | null = null;
  for (const r of completed) {
    if (bestScore === null || r.score < bestScore) {
      bestScore = r.score;
      bestRound = r;
    }
  }

  const averageScore = completed.length
    ? round1(completed.reduce((s, r) => s + r.score, 0) / completed.length)
    : null;
  const averageScoreVsPar = completed.length
    ? round1(completed.reduce((s, r) => s + r.score_vs_par, 0) / completed.length)
    : null;

  let fairwayHits = 0;
  let fairwayAttempts = 0;
  let girCount = 0;
  let holeCount = 0;
  let putts = 0;
  let penalty = 0;
  let leftMisses = 0;
  let rightMisses = 0;

  for (const round of completed) {
    const holes = holesByRound.get(round.id) ?? [];
    for (const h of holes) {
      holeCount++;
      putts += h.putts;
      penalty += h.penalty_strokes;
      if (h.gir) girCount++;
      if (h.fairway_result && h.fairway_result !== 'na') {
        fairwayAttempts++;
        if (h.fairway_result === 'hit') fairwayHits++;
        if (h.fairway_result === 'left') leftMisses++;
        if (h.fairway_result === 'right') rightMisses++;
      }
    }
  }

  const fairwaysHitPct = fairwayAttempts ? Math.round((fairwayHits / fairwayAttempts) * 100) : null;
  const girPct = holeCount ? Math.round((girCount / holeCount) * 100) : null;
  const puttsPerRound = completed.length ? round1(putts / completed.length) : null;
  const penaltyAverage = completed.length ? round1(penalty / completed.length) : null;

  let missBias: 'left' | 'right' | 'balanced' | null = null;
  if (leftMisses + rightMisses > 0) {
    if (leftMisses > rightMisses + 2) missBias = 'left';
    else if (rightMisses > leftMisses + 2) missBias = 'right';
    else missBias = 'balanced';
  }

  const recentScores = completed
    .slice(0, 10)
    .map((r) => ({
      date: dayjs(r.started_at).format('MMM D'),
      score: r.score,
      vsPar: r.score_vs_par
    }))
    .reverse();

  const recentDifferentials = recent
    .filter((r) => r.handicap_differential != null)
    .map((r) => ({
      date: dayjs(r.started_at).format('MMM D'),
      differential: r.handicap_differential
    }));

  return {
    handicap,
    bestScore,
    bestRound,
    averageScore,
    averageScoreVsPar,
    fairwaysHitPct,
    girPct,
    puttsPerRound,
    penaltyAverage,
    missBias,
    recentScores,
    handicapTrend: recentDifferentials.slice().reverse(),
    recentDifferentials
  };
}

export interface RoundDetailStats {
  totalScore: number;
  totalPar: number;
  scoreVsPar: number;
  putts: number;
  fairwaysHitPct: number;
  missLeftPct: number;
  missRightPct: number;
  sandShots: number;
  greensInRegulation: number;
  penaltyCount: number;
  clubsUsed: Set<string>;
  durationMinutes: number;
}

export function detailRoundStats(
  round: Round,
  holes: Array<{
    par: number;
    strokes: number;
    putts: number;
    sand: boolean;
    gir: boolean;
    penalty_strokes: number;
    fairway_result: string | null;
  }>,
  shots: Shot[]
): RoundDetailStats {
  let totalScore = 0;
  let totalPar = 0;
  let putts = 0;
  let sandShots = 0;
  let greensInRegulation = 0;
  let penaltyCount = 0;
  let attempts = 0;
  let hits = 0;
  let left = 0;
  let right = 0;
  for (const h of holes) {
    totalScore += h.strokes + h.penalty_strokes;
    totalPar += h.par;
    putts += h.putts;
    if (h.sand) sandShots++;
    if (h.gir) greensInRegulation++;
    penaltyCount += h.penalty_strokes;
    if (h.fairway_result && h.fairway_result !== 'na') {
      attempts++;
      if (h.fairway_result === 'hit') hits++;
      if (h.fairway_result === 'left') left++;
      if (h.fairway_result === 'right') right++;
    }
  }
  const clubsUsed = new Set<string>();
  for (const s of shots) {
    if (s.club_id) clubsUsed.add(s.club_id);
  }

  const startMs = new Date(round.started_at).getTime();
  const endMs = round.completed_at ? new Date(round.completed_at).getTime() : Date.now();
  const durationMinutes = Math.max(0, Math.round((endMs - startMs) / 60000));

  return {
    totalScore,
    totalPar,
    scoreVsPar: totalScore - totalPar,
    putts,
    fairwaysHitPct: attempts ? Math.round((hits / attempts) * 100) : 0,
    missLeftPct: attempts ? Math.round((left / attempts) * 100) : 0,
    missRightPct: attempts ? Math.round((right / attempts) * 100) : 0,
    sandShots,
    greensInRegulation,
    penaltyCount,
    clubsUsed,
    durationMinutes
  };
}

function round1(n: number) {
  return Math.round(n * 10) / 10;
}

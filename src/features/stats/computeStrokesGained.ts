import type { Shot, Lie, SkillLevel } from '@/models';
import { expectedStrokes, type SGLie } from './strokesGainedBaseline';

export type SGCategory = 'tee' | 'approach' | 'arg' | 'putting';

export interface ShotStrokesGained {
  shotId: string;
  shotNumber: number;
  roundId: string;
  holeId: string;
  clubId: string | null;
  sg: number;
  category: SGCategory;
  lieStart: SGLie;
  distStart: number; // yards for non-green, feet for green
  lieEnd: SGLie | 'hole';
  distEnd: number;
}

export interface RoundStrokesGained {
  total: number;
  tee: number;
  approach: number;
  arg: number;
  putting: number;
  /** Number of shots that contributed to the totals (had complete data). */
  scoredShotCount: number;
}

const M_PER_YD = 0.9144;
const FT_PER_YD = 3;
const R_EARTH_M = 6371000;
const toRad = (d: number) => (d * Math.PI) / 180;

/** Haversine distance in meters between two lat/lng pairs. */
function haversineMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const la1 = toRad(a.lat);
  const la2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R_EARTH_M * Math.asin(Math.sqrt(h));
}

/**
 * DB `Lie` → SG baseline lie. 'bunker' becomes 'sand'; 'penalty' falls
 * back to 'rough' (no formal baseline for penalty lies — close
 * approximation). null returns null (caller skips the shot).
 */
function mapLie(lie: Lie | null): SGLie | null {
  if (lie == null) return null;
  if (lie === 'bunker') return 'sand';
  if (lie === 'penalty') return 'rough';
  // 'fairway' | 'rough' | 'green' | 'fringe' — same names on both sides.
  return lie as SGLie;
}

/**
 * Build the per-hole pin position map from the user's history of made
 * putts. Each "physical hole" (course_id + hole_number) gets a pin
 * coord = mean of every recorded made-putt end position across rounds.
 *
 * Keyed by round_holes.id so the SG compute can look up by `shot.hole_id`
 * directly. Holes with no made putt yet are absent from the map and
 * their shots are excluded from SG totals.
 */
export interface RoundHoleRef {
  /** round_holes.id */
  id: string;
  courseId: string;
  holeNumber: number;
}

export function derivePinsFromMadePutts(
  shots: Shot[],
  roundHoles: RoundHoleRef[]
): Map<string, { lat: number; lng: number }> {
  // First, group made-putt endpoints by (courseId, holeNumber).
  const refsByRoundHoleId = new Map<string, RoundHoleRef>(
    roundHoles.map((r) => [r.id, r])
  );
  const sums = new Map<string, { lat: number; lng: number; count: number }>();
  const key = (cid: string, h: number) => `${cid}__${h}`;
  for (const s of shots) {
    if (s.target_result !== 'made') continue;
    if (s.end_lat == null || s.end_lng == null) continue;
    const ref = refsByRoundHoleId.get(s.hole_id);
    if (!ref) continue;
    const k = key(ref.courseId, ref.holeNumber);
    const cur = sums.get(k) ?? { lat: 0, lng: 0, count: 0 };
    cur.lat += s.end_lat;
    cur.lng += s.end_lng;
    cur.count += 1;
    sums.set(k, cur);
  }
  // Now project the means back onto every round_holes.id for the same
  // physical hole — different rounds → different round_holes rows, but
  // same pin.
  const out = new Map<string, { lat: number; lng: number }>();
  for (const ref of roundHoles) {
    const agg = sums.get(key(ref.courseId, ref.holeNumber));
    if (!agg || agg.count === 0) continue;
    out.set(ref.id, { lat: agg.lat / agg.count, lng: agg.lng / agg.count });
  }
  return out;
}

/**
 * Distance from a (lat, lng) to the pin, in the units the baseline
 * expects: yards for non-green lies, feet for green putts.
 */
function distanceToPin(
  pos: { lat: number; lng: number },
  pin: { lat: number; lng: number },
  lie: SGLie
): number {
  const m = haversineMeters(pos, pin);
  if (lie === 'green') return (m / M_PER_YD) * FT_PER_YD;
  return m / M_PER_YD;
}

/**
 * Compute strokes-gained per shot. Skips shots that lack the data we
 * need to score them — no GPS, no pin available, ambiguous lie, etc.
 * Caller can sum the returned array to get round / category totals.
 */
export function computeStrokesGained(
  shots: Shot[],
  pinByRoundHoleId: Map<string, { lat: number; lng: number }>,
  skill: SkillLevel | null = 'average'
): ShotStrokesGained[] {
  // Sort shots into per-hole, shot-number order so we can derive each
  // shot's end-lie from the next shot's start-lie.
  const byHole = new Map<string, Shot[]>();
  for (const s of shots) {
    if (!s.hole_id) continue;
    const arr = byHole.get(s.hole_id) ?? [];
    arr.push(s);
    byHole.set(s.hole_id, arr);
  }
  for (const arr of byHole.values()) {
    arr.sort((a, b) => a.shot_number - b.shot_number);
  }

  const out: ShotStrokesGained[] = [];
  for (const [holeId, holeShots] of byHole) {
    const pin = pinByRoundHoleId.get(holeId);
    if (!pin) continue; // No pin → can't compute SG on this hole.

    for (let i = 0; i < holeShots.length; i++) {
      const s = holeShots[i];
      const next = holeShots[i + 1];

      // Need shot start GPS to compute distance to pin.
      if (s.start_lat == null || s.start_lng == null) continue;

      // Start lie. Shot #1 is always tee regardless of stored lie value
      // (the user likely typed 'fairway' or left null).
      let lieStart: SGLie | null;
      if (s.shot_number === 1) {
        lieStart = 'tee';
      } else {
        lieStart = mapLie(s.lie);
      }
      if (lieStart == null) continue;

      const startPos = { lat: s.start_lat, lng: s.start_lng };
      const distStart = distanceToPin(startPos, pin, lieStart);

      // End lie + end distance.
      // 'made' = ball in the hole → expected_end = 0, distEnd = 0.
      // Else if there's a next shot: use its start position + lie.
      // Else (last shot, not made): we don't know what happened →
      // skip (no honest way to score it).
      let lieEnd: SGLie | 'hole' | null = null;
      let distEnd = 0;
      if (s.target_result === 'made') {
        lieEnd = 'hole';
        distEnd = 0;
      } else if (next && next.start_lat != null && next.start_lng != null) {
        const nextLie = mapLie(next.lie);
        if (nextLie == null) continue;
        lieEnd = nextLie;
        distEnd = distanceToPin(
          { lat: next.start_lat, lng: next.start_lng },
          pin,
          nextLie
        );
      } else {
        continue;
      }

      const expStart = expectedStrokes(lieStart, distStart, skill);
      const expEnd = expectedStrokes(lieEnd, distEnd, skill);
      const sg = expStart - expEnd - 1;

      out.push({
        shotId: s.id,
        shotNumber: s.shot_number,
        roundId: s.round_id,
        holeId,
        clubId: s.club_id,
        sg,
        category: categorize(lieStart, distStart),
        lieStart,
        distStart,
        lieEnd,
        distEnd
      });
    }
  }
  return out;
}

/** Broadie's standard category split. Putts come from the green; tee
 *  shots are everything on the tee box; everything else is approach if
 *  > 30 yds to the pin, around-the-green if ≤ 30 yds. */
function categorize(lie: SGLie, distYds: number): SGCategory {
  if (lie === 'tee') return 'tee';
  if (lie === 'green') return 'putting';
  if (distYds <= 30) return 'arg';
  return 'approach';
}

/** Aggregate per-shot SG into round-level totals + category breakdown. */
export function aggregateStrokesGained(shotSGs: ShotStrokesGained[]): RoundStrokesGained {
  const out: RoundStrokesGained = {
    total: 0,
    tee: 0,
    approach: 0,
    arg: 0,
    putting: 0,
    scoredShotCount: 0
  };
  for (const s of shotSGs) {
    out.total += s.sg;
    out[s.category] += s.sg;
    out.scoredShotCount += 1;
  }
  return out;
}

export interface RoundSGTrendPoint {
  roundId: string;
  /** ISO start date for the round — sorted chronologically. */
  date: string;
  /** Short label for the x-axis tick. */
  label: string;
  totalSG: number;
  scoredShotCount: number;
}

/**
 * Per-round SG totals sorted chronologically. Rounds with zero scored
 * shots (no GPS or no made-putt pin reference) are dropped — plotting
 * a 0 for them would be misleading.
 */
export function aggregateStrokesGainedByRound(
  shotSGs: ShotStrokesGained[],
  rounds: Array<{ id: string; started_at: string }>
): RoundSGTrendPoint[] {
  const sums = new Map<string, { total: number; count: number }>();
  for (const s of shotSGs) {
    const cur = sums.get(s.roundId) ?? { total: 0, count: 0 };
    cur.total += s.sg;
    cur.count += 1;
    sums.set(s.roundId, cur);
  }
  const out: RoundSGTrendPoint[] = [];
  for (const r of rounds) {
    const agg = sums.get(r.id);
    if (!agg || agg.count === 0) continue;
    const d = new Date(r.started_at);
    out.push({
      roundId: r.id,
      date: r.started_at,
      // M/D label — kept short so a long x-axis with 10+ rounds doesn't
      // collide on a phone-width chart.
      label: `${d.getMonth() + 1}/${d.getDate()}`,
      totalSG: agg.total,
      scoredShotCount: agg.count
    });
  }
  out.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  return out;
}

export interface ClubStrokesGained {
  clubId: string;
  clubName: string;
  shotCount: number;
  totalSG: number;
  /** Average SG per shot — the headline metric. Normalizes for usage
   *  so a driver hit 50 times doesn't automatically rank above a
   *  3-wood hit 5 times. */
  sgPerShot: number;
}

/**
 * Group per-shot SG by club and sort by per-shot SG descending. Only
 * clubs with ≥ minShots shots show up — below that the per-shot mean
 * is dominated by 1–2 outliers and reads as noise. Clubs not in the
 * bag (e.g., deleted clubs whose shots still live in history) get a
 * fallback name.
 */
export function aggregateStrokesGainedByClub(
  shotSGs: ShotStrokesGained[],
  bag: Array<{ clubId: string; name: string; customName?: string | null }>,
  minShots: number = 5
): ClubStrokesGained[] {
  const sums = new Map<string, { total: number; count: number }>();
  for (const s of shotSGs) {
    if (!s.clubId) continue;
    const cur = sums.get(s.clubId) ?? { total: 0, count: 0 };
    cur.total += s.sg;
    cur.count += 1;
    sums.set(s.clubId, cur);
  }
  const out: ClubStrokesGained[] = [];
  for (const [clubId, agg] of sums) {
    if (agg.count < minShots) continue;
    const club = bag.find((c) => c.clubId === clubId);
    out.push({
      clubId,
      clubName: club ? club.customName || club.name : 'Club',
      shotCount: agg.count,
      totalSG: agg.total,
      sgPerShot: agg.total / agg.count
    });
  }
  out.sort((a, b) => b.sgPerShot - a.sgPerShot);
  return out;
}

import type { Shot, BagClub } from '@/models';

/**
 * Per-club shot dispersion. Aggregates the shots a user has hit with a
 * given club across every recorded round and surfaces:
 *   • shotCount             — sample size (≥ 3 needed for meaningful std-dev)
 *   • avgYards / stdDevYds  — distance variance
 *   • hit/left/right/short/long — miss-bias counts
 *   • scatterPoints         — real (lateral, distance) pairs derived from
 *                             the shot's GPS start/end against a per-hole
 *                             aim target (green centroid).
 *
 * Putts are excluded — their distances are feet, not yards, and the
 * dispersion notion doesn't translate (the miss vocabulary is different
 * too: made/missed vs hit/left/right). Filter the bag to non-putters
 * before passing in.
 */
export interface ClubDispersion {
  clubId: string;
  clubName: string;
  shotCount: number;
  avgYards: number | null;
  stdDevYards: number | null;
  hitCount: number;
  leftCount: number;
  rightCount: number;
  shortCount: number;
  longCount: number;
  /** Real GPS-derived landing pattern. lateralYds is signed (left
   *  negative, right positive); distanceYds is the GPS-calculated or
   *  user-entered yardage. Only shots with start_lat/lng, end_lat/lng,
   *  AND a known aim target for their hole are plotted. */
  scatterPoints: Array<{ lateralYds: number; distanceYds: number }>;
}

/**
 * Aim-target lookup (optional). Maps a shot's `hole_id` (the round_holes
 * row id) to an explicit aim point — usually the green centroid or pin
 * position. When supplied, this wins over the auto-derived per-hole
 * mean bearing.
 *
 * Auto-derivation runs as a fallback when the lookup is missing or has
 * no entry for a shot's hole — needed because most courses don't have
 * OSM-synced green coords yet, but every shot already has GPS.
 */
export type AimTargetByHole = Map<string, { lat: number; lng: number }>;

const M_PER_YD = 0.9144;
const R_EARTH_M = 6371000;
const toRad = (d: number) => (d * Math.PI) / 180;

/**
 * Equirectangular projection of `to` relative to `from`. Returns east/
 * north offset in meters. Accurate to ~1cm at golf-range distances.
 */
function localOffset(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number }
): { x: number; y: number } {
  const cosLat = Math.cos(toRad(from.lat));
  return {
    x: toRad(to.lng - from.lng) * R_EARTH_M * cosLat,
    y: toRad(to.lat - from.lat) * R_EARTH_M
  };
}

/**
 * Signed lateral distance (yards) of `end` from the line through
 * `start` heading at compass `aimBearingDeg` (0=N, 90=E). Positive =
 * right of aim, negative = left.
 */
function lateralOffsetYardsFromBearing(
  start: { lat: number; lng: number },
  aimBearingDeg: number,
  end: { lat: number; lng: number }
): number {
  const e = localOffset(start, end);
  // Convert compass bearing to (east, north) unit vector. Compass
  // 0° = north (+y), 90° = east (+x), so aim = (sin, cos).
  const aimRad = toRad(aimBearingDeg);
  const ax = Math.sin(aimRad);
  const ay = Math.cos(aimRad);
  // Right-perpendicular of (ax, ay) is (ay, -ax).
  const lateralM = e.x * ay + e.y * -ax;
  return lateralM / M_PER_YD;
}

/**
 * Compass bearing in degrees from `start` to `end`. Returns null when
 * the two points coincide (no direction defined).
 */
function bearingDegrees(
  start: { lat: number; lng: number },
  end: { lat: number; lng: number }
): number | null {
  const o = localOffset(start, end);
  if (o.x === 0 && o.y === 0) return null;
  // atan2 with (east, north) gives compass bearing directly when args
  // are (east, north): atan2(x, y) where x=east, y=north → 0 at north.
  return (Math.atan2(o.x, o.y) * 180) / Math.PI;
}

/**
 * Circular mean of a set of compass bearings (degrees). Handles wrap-
 * around at 0/360 correctly. Returns null when input is empty.
 */
function circularMeanDegrees(bearings: number[]): number | null {
  if (bearings.length === 0) return null;
  let sx = 0;
  let sy = 0;
  for (const b of bearings) {
    const r = toRad(b);
    sx += Math.sin(r);
    sy += Math.cos(r);
  }
  return (Math.atan2(sx, sy) * 180) / Math.PI;
}

export function computeClubDispersion(
  shots: Shot[],
  bag: BagClub[],
  aimTargetByHole: AimTargetByHole = new Map()
): ClubDispersion[] {
  // Pre-compute per-hole mean bearings from ALL shots on that hole
  // (across clubs). Self-referencing aim direction — works even when
  // the course has no green coords stored. Used as a fallback when
  // `aimTargetByHole` doesn't have an entry for a shot's hole.
  const shotsByHole = new Map<string, Shot[]>();
  for (const s of shots) {
    if (!s.hole_id) continue;
    const arr = shotsByHole.get(s.hole_id) ?? [];
    arr.push(s);
    shotsByHole.set(s.hole_id, arr);
  }
  const meanBearingByHole = new Map<string, number>();
  for (const [holeId, holeShots] of shotsByHole) {
    const bearings: number[] = [];
    for (const s of holeShots) {
      if (
        s.start_lat == null ||
        s.start_lng == null ||
        s.end_lat == null ||
        s.end_lng == null
      ) {
        continue;
      }
      const b = bearingDegrees(
        { lat: s.start_lat, lng: s.start_lng },
        { lat: s.end_lat, lng: s.end_lng }
      );
      if (b != null) bearings.push(b);
    }
    const mean = circularMeanDegrees(bearings);
    if (mean != null) meanBearingByHole.set(holeId, mean);
  }
  // Group shots by clubId, dropping nulls.
  const byClub = new Map<string, Shot[]>();
  for (const s of shots) {
    if (!s.club_id) continue;
    const arr = byClub.get(s.club_id) ?? [];
    arr.push(s);
    byClub.set(s.club_id, arr);
  }

  const out: ClubDispersion[] = [];
  for (const club of bag) {
    if (club.category === 'putter') continue;
    const clubShots = byClub.get(club.clubId) ?? [];
    if (clubShots.length === 0) continue;

    // Distances — prefer GPS-calculated when present, fall back to user
    // entry. Feet entries are converted to yards (3 ft = 1 yd) even
    // though we already filtered putters; defensively guard for stray
    // chip shots logged in feet.
    const yardages: number[] = [];
    for (const s of clubShots) {
      const raw =
        s.calculated_distance != null
          ? s.calculated_distance
          : s.distance != null
            ? s.distance
            : null;
      if (raw == null) continue;
      const yds = s.distance_unit === 'feet' ? raw / 3 : raw;
      yardages.push(yds);
    }
    const avg =
      yardages.length > 0
        ? yardages.reduce((a, b) => a + b, 0) / yardages.length
        : null;
    const stdDev =
      yardages.length > 1 && avg != null
        ? Math.sqrt(
            yardages.reduce((acc, v) => acc + (v - avg) ** 2, 0) / yardages.length
          )
        : null;

    let hit = 0,
      left = 0,
      right = 0,
      short = 0,
      long = 0;
    const scatterPoints: ClubDispersion['scatterPoints'] = [];
    for (const s of clubShots) {
      // Bias counts come from the categorical target_result the user
      // logged — these are still useful even without GPS.
      switch (s.target_result) {
        case 'hit':
          hit++;
          break;
        case 'left':
          left++;
          break;
        case 'right':
          right++;
          break;
        case 'short':
          short++;
          break;
        case 'long':
          long++;
          break;
        default:
          // 'made' / 'missed' / null — not part of the bias breakdown.
          break;
      }

      // Scatter point requires GPS start + end. Skip otherwise — we
      // can't honestly plot a shot whose landing position wasn't
      // recorded.
      if (
        s.start_lat == null ||
        s.start_lng == null ||
        s.end_lat == null ||
        s.end_lng == null
      ) {
        continue;
      }

      // Pick an aim direction. Explicit per-hole target wins (e.g.,
      // green centroid from the courses table). Falls back to the
      // self-derived mean bearing of all shots on this hole, which
      // works for courses without OSM-synced green coords.
      let aimBearing: number | null = null;
      const explicitAim = aimTargetByHole.get(s.hole_id);
      if (explicitAim) {
        aimBearing = bearingDegrees(
          { lat: s.start_lat, lng: s.start_lng },
          explicitAim
        );
      }
      if (aimBearing == null) {
        aimBearing = meanBearingByHole.get(s.hole_id) ?? null;
      }
      if (aimBearing == null) continue;

      const lateralYds = lateralOffsetYardsFromBearing(
        { lat: s.start_lat, lng: s.start_lng },
        aimBearing,
        { lat: s.end_lat, lng: s.end_lng }
      );

      const ydsRaw =
        s.calculated_distance != null
          ? s.calculated_distance
          : s.distance != null
            ? s.distance
            : null;
      const distanceYds =
        ydsRaw != null
          ? s.distance_unit === 'feet'
            ? ydsRaw / 3
            : ydsRaw
          : avg ?? 0;

      scatterPoints.push({ lateralYds, distanceYds });
    }

    out.push({
      clubId: club.clubId,
      clubName: club.customName || club.name,
      shotCount: clubShots.length,
      avgYards: avg != null ? Math.round(avg) : null,
      stdDevYards: stdDev != null ? Math.round(stdDev) : null,
      hitCount: hit,
      leftCount: left,
      rightCount: right,
      shortCount: short,
      longCount: long,
      scatterPoints
    });
  }

  // Most-used clubs first — that's where dispersion data is most reliable.
  out.sort((a, b) => b.shotCount - a.shotCount);
  return out;
}

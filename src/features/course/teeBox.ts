import type { HoleFeature } from '@/models';

/** Metres per yard, for comparing OSM geometry against scorecard yardages. */
const YARD_M = 0.9144;

/**
 * How near a mapped tee box must be to the walked-back point to be treated as
 * that tee. A tee box is itself 20-40 m long, so this is about one box.
 */
const SNAP_M = 35;

/**
 * Fallback tolerance for the straight-line match, used only when a hole has no
 * centreline. Loose because straight-line distance under-reads the card on any
 * dogleg — which is exactly the error walking the centreline removes.
 */
const MATCH_TOLERANCE_YARDS = 60;

function metres(a: [number, number], b: [number, number]): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function centroidOf(coords: unknown): [number, number] | null {
  // hole_features.coords is [[lng,lat],…] for a line, [[[lng,lat],…]] for a
  // polygon. Flatten one level when we find a ring of rings.
  const raw = coords as number[][] | number[][][];
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const ring = (Array.isArray(raw[0]) && Array.isArray(raw[0][0]) ? raw[0] : raw) as number[][];
  const pts = ring.filter((p) => Array.isArray(p) && p.length >= 2);
  if (pts.length === 0) return null;
  return [
    pts.reduce((s, p) => s + p[0], 0) / pts.length,
    pts.reduce((s, p) => s + p[1], 0) / pts.length
  ];
}

/**
 * Walk back `metres` along the hole's playing line, starting at the green.
 *
 * The centreline's stored direction is not guaranteed, so orientation is taken
 * from the geometry: whichever end sits closer to the green IS the green end.
 * Returns the far end when the line is shorter than the distance asked for,
 * which happens when OSM traced only part of the hole.
 */
function walkBackFromGreen(
  centerline: [number, number][] | null | undefined,
  green: [number, number],
  distM: number
): [number, number] | null {
  if (!centerline || centerline.length < 2) return null;
  const line =
    metres(centerline[0], green) < metres(centerline[centerline.length - 1], green)
      ? [...centerline].reverse()
      : centerline;

  let remaining = distM;
  for (let i = line.length - 1; i > 0; i--) {
    const a = line[i];
    const b = line[i - 1];
    const seg = metres(a, b);
    if (seg >= remaining) {
      const t = seg === 0 ? 0 : remaining / seg;
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    }
    remaining -= seg;
  }
  return line[0];
}

/**
 * Which tee box the golfer is actually playing from.
 *
 * OSM maps every tee box on a hole but rarely labels them by colour, so there
 * is nothing to match "White" against directly. What we DO have is the
 * scorecard yardage for the selected tee — and tee colours are, definitionally,
 * distances. So the white tee is simply the box whose distance to the green is
 * closest to the white yardage.
 *
 * Returns null when there is nothing to go on (no tee polygons, no yardage, or
 * no box near the expected distance), and callers fall back to the hole's
 * stored tee — which is whichever box the OSM sync happened to pick.
 */
export function selectedTeeBox(
  features: HoleFeature[],
  green: [number, number] | null,
  yardsFromSelectedTee: number | null | undefined,
  centerline?: [number, number][] | null
): [number, number] | null {
  if (!green || !yardsFromSelectedTee || yardsFromSelectedTee <= 0) return null;
  const targetM = yardsFromSelectedTee * YARD_M;

  const boxes = features
    .filter((f) => f.feature_type === 'tee')
    .map((f) => centroidOf(f.coords))
    .filter((c): c is [number, number] => c !== null);

  // Preferred: walk the card's yardage back along the hole itself. This is how
  // the yardage was measured in the first place, so on a dogleg it lands where
  // the tee actually is instead of somewhere short along the straight line.
  const walked = walkBackFromGreen(centerline, green, targetM);
  if (walked) {
    // A mapped box near that point is a better answer than the point — it is
    // the real tee, surveyed, rather than a position inferred from a number.
    let nearest: { pt: [number, number]; d: number } | null = null;
    for (const pt of boxes) {
      const d = metres(pt, walked);
      if (!nearest || d < nearest.d) nearest = { pt, d };
    }
    if (nearest && nearest.d <= SNAP_M) return nearest.pt;
    // No box there. Trust the measurement anyway: OSM often maps one tee box
    // per hole, and using it for every colour is what put the white tee on the
    // back markers.
    return walked;
  }

  // No centreline: fall back to matching a box by straight-line distance.
  if (boxes.length === 0) return null;
  let best: { pt: [number, number]; delta: number } | null = null;
  for (const pt of boxes) {
    const delta = Math.abs(metres(pt, green) / YARD_M - yardsFromSelectedTee);
    if (!best || delta < best.delta) best = { pt, delta };
  }
  if (!best || best.delta > MATCH_TOLERANCE_YARDS) return null;
  return best.pt;
}

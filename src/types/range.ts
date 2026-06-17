// Domain types for the GPS driving-range practice mode.
//
// camelCase interfaces the app works with. The Supabase row shapes (snake_case,
// metric) live in `database.ts`; `rangeRepo` maps between them and converts the
// stored meters to display yards.

/** A geographic point in {lat, lng} form (degrees). */
export interface LatLng {
  lat: number;
  lng: number;
}

/** A user-drawn aim target on the range (a green or spot). */
export interface RangeTarget {
  id: string;
  userId: string;
  label: string | null;
  kind: 'circle' | 'polygon';
  /** Mat origin where this target was drawn (used to reload it at the range). */
  anchor: LatLng;
  /** Circle geometry. */
  center: LatLng | null;
  radiusM: number | null;
  /** Polygon ring (freeform shape). */
  points: LatLng[] | null;
}

/** One practice session at a mat: a fixed origin + a tapped target line. */
export interface RangeSession {
  id: string;
  userId: string;
  /** Mat location, captured once at session start. */
  origin: LatLng;
  /** Aim point tapped down the range; defines the target line. */
  target: LatLng;
  /** Degrees 0-360, origin -> target. */
  targetBearing: number;
  startedAt: string; // ISO
  endedAt: string | null;
}

/** One logged ball (one map tap), decomposed relative to the target line. */
export interface RangeShot {
  id: string;
  sessionId: string;
  userId: string;
  /** Deferred integration seam — populated from a watch swing event later. */
  swingEventId: string | null;
  /** Club label (manual in v1; watch-supplied later). */
  club: string | null;
  land: LatLng;
  /** Carry along the target line, yards. */
  carryYards: number;
  /** Perpendicular offset, yards. + = right of line, - = left. */
  offlineYards: number;
  /** Straight-line origin -> land, yards. */
  totalYards: number;
  createdAt: string; // ISO
}

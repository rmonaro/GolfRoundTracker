// Distance unit + formatter for the hole layout map view.
//
// Note: `DistanceUnit` already exists in src/types/database.ts as the per-shot
// input unit (`'yards' | 'feet'`, used by AddShotSheet — flips to feet when a
// putter is selected). That's a different concept from map-distance display
// (yards vs. meters), so this file uses `MapDistanceUnit` to keep them
// unambiguous when both types are imported into the same module.
//
// No global yards↔meters preference exists yet; callers default to 'yds'.
// A user-facing toggle can be added later by extending settingsStore and
// passing the value through here.

export type MapDistanceUnit = 'yds' | 'm';

export const metersToYards = (m: number): number => m * 1.0936133;

export function formatDistance(
  meters: number | null,
  unit: MapDistanceUnit = 'yds'
): string {
  if (meters == null) return '—';
  if (unit === 'm') return `${Math.round(meters)} m`;
  return `${Math.round(metersToYards(meters))} yds`;
}

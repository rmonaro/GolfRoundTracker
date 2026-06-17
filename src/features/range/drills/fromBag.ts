import type { BagClub } from '@/models';
import type { DrillClub } from './types';

/**
 * Map the user's bag (same shape the practice screens use) to drill clubs.
 * The putter is excluded — drills are full-swing/distance practice, never putting.
 */
export function bagToDrillClubs(clubs: BagClub[]): DrillClub[] {
  return clubs
    .filter((c) => c.category !== 'putter')
    .map((c) => ({
      label: c.customName || c.name,
      category: c.category,
      carryYards: c.typicalDistanceYards
    }));
}

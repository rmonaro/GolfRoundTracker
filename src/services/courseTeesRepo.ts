import { supabase } from '@/lib/supabase';
import type { CourseTee, CourseTeeSource } from '@/models';
import { toAppError } from './errors';

/**
 * Which source wins when two of them describe the same tee.
 *
 * A course can carry tee sets from several sources at once — GolfCourseAPI
 * ('api'), OpenGolfAPI ('opengolf'), named OSM tee boxes ('osm'), and anything
 * an admin typed in ('manual'). They overlap: Cape Cod National has "BLUE" from
 * GolfCourseAPI at 74.3/143 and "Blue" from OpenGolfAPI at 74.0/135 — the same
 * tee, the same yardage, different ratings.
 *
 * That matters beyond tidiness: the selected tee stamps course_rating and
 * slope_rating onto the round, which drives the handicap differential. So the
 * picker must show each tee exactly once, from a predictable source.
 *
 * Order: a human's correction beats GolfCourseAPI's scorecard, which beats
 * OpenGolfAPI's community data, which beats an OSM tee box that carries a name
 * but no ratings at all.
 */
const SOURCE_RANK: Record<CourseTeeSource, number> = {
  manual: 0,
  api: 1,
  opengolf: 2,
  osm: 3
};

/**
 * Tee identity for dedupe purposes: same gender, same name ignoring case and
 * punctuation. "GOLD / WHITE COMBO" and "Gold/White Combo" are one tee.
 */
function teeKey(tee: CourseTee): string {
  const name = tee.tee_name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  return `${tee.gender ?? 'any'}::${name}`;
}

/**
 * Collapse tees that describe the same physical tee box, keeping the row from
 * the highest-ranked source. Input order is preserved for the rows that
 * survive, so the caller's ordering (longest yardage first) still holds.
 */
export function dedupeTees(tees: CourseTee[]): CourseTee[] {
  const winners = new Map<string, CourseTee>();
  for (const tee of tees) {
    const key = teeKey(tee);
    const held = winners.get(key);
    if (!held || SOURCE_RANK[tee.source] < SOURCE_RANK[held.source]) {
      winners.set(key, tee);
    }
  }
  const kept = new Set(winners.values());
  return tees.filter((t) => kept.has(t));
}

export const courseTeesRepo = {
  /**
   * Named tee sets for a course (Blue / White / Red …), populated at import time
   * from the GolfCourseAPI scorecard, the OpenGolfAPI scorecard, or named OSM
   * tee boxes. Ordered longest-first (championship tees at the top) so the
   * picker reads back-to-front, and deduped so the same tee never appears twice
   * because two sources both described it.
   */
  async listForCourse(courseId: string): Promise<CourseTee[]> {
    return dedupeTees(await this.listAllForCourse(courseId));
  },

  /**
   * Every tee row including cross-source duplicates. For the admin course page,
   * where seeing that two sources disagree is the point — the player-facing
   * picker wants `listForCourse` instead.
   */
  async listAllForCourse(courseId: string): Promise<CourseTee[]> {
    const { data, error } = await supabase
      .from('course_tees')
      .select('*')
      .eq('course_id', courseId)
      .order('total_yards', { ascending: false, nullsFirst: false });
    if (error) throw toAppError(error, 'Could not load tees');
    return (data ?? []) as CourseTee[];
  }
};

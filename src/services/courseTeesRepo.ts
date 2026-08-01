import { supabase } from '@/lib/supabase';
import type { CourseTee } from '@/models';
import { toAppError } from './errors';

export const courseTeesRepo = {
  /**
   * Named tee sets for a course (Blue / White / Red …), populated at import time
   * from the GolfCourseAPI scorecard or named OSM tee boxes. Ordered longest-
   * first (championship tees at the top) so the picker reads back-to-front.
   */
  async listForCourse(courseId: string): Promise<CourseTee[]> {
    const { data, error } = await supabase
      .from('course_tees')
      .select('*')
      .eq('course_id', courseId)
      .order('total_yards', { ascending: false, nullsFirst: false });
    if (error) throw toAppError(error, 'Could not load tees');
    return (data ?? []) as CourseTee[];
  }
};

import { supabase } from '@/lib/supabase';
import type { CourseHole, HoleFeature, CourseOsmStatus, OrientationConfidence } from '@/models';
import { toAppError } from './errors';

export interface HoleLayoutData {
  hole: CourseHole;
  features: HoleFeature[];
}

export const holesRepo = {
  /**
   * Fetch the static hole + all assigned features for rendering. Also returns the
   * parent course's `osm_status` so callers can render the right empty/pending state.
   */
  async getLayout(
    courseId: string,
    holeNumber: number
  ): Promise<{ data: HoleLayoutData | null; courseStatus: CourseOsmStatus | null }> {
    const { data: course, error: courseErr } = await supabase
      .from('courses')
      .select('osm_status')
      .eq('id', courseId)
      .maybeSingle();
    if (courseErr) throw toAppError(courseErr, 'Could not load course');
    if (!course) return { data: null, courseStatus: null };

    const courseStatus = (course.osm_status ?? null) as CourseOsmStatus | null;
    // Short-circuit when there's no chance of geometry.
    if (courseStatus === 'skip' || courseStatus === 'no_coverage') {
      return { data: null, courseStatus };
    }

    const { data: hole, error: holeErr } = await supabase
      .from('holes')
      .select('*')
      .eq('course_id', courseId)
      .eq('hole_number', holeNumber)
      .maybeSingle();
    if (holeErr) throw toAppError(holeErr, 'Could not load hole geometry');
    if (!hole) return { data: null, courseStatus };

    const { data: features, error: featErr } = await supabase
      .from('hole_features')
      .select('*')
      .eq('hole_id', hole.id);
    if (featErr) throw toAppError(featErr, 'Could not load hole features');

    return {
      data: { hole: hole as CourseHole, features: (features ?? []) as HoleFeature[] },
      courseStatus
    };
  },

  /** Admin-flip helpers used by the orientation review queue (Phase 4). */
  async setOrientationConfirmed(holeId: string): Promise<void> {
    const { error } = await supabase
      .from('holes')
      .update({ orientation_confidence: 'manual' as OrientationConfidence })
      .eq('id', holeId);
    if (error) throw toAppError(error, 'Could not save orientation');
  },

  /**
   * Update the shared course-wide pin position for a hole. Passing null/null
   * clears the override and falls everyone back to the course's stored green
   * coord. Backed by a SECURITY DEFINER RPC so callers can only touch the
   * pin columns, never the rest of the holes row.
   */
  async setPin(holeId: string, lng: number | null, lat: number | null): Promise<void> {
    const { error } = await supabase.rpc('set_hole_pin', {
      p_hole_id: holeId,
      p_lng: lng,
      p_lat: lat
    });
    if (error) throw toAppError(error, 'Could not save pin position');
  },

  async flipHole(holeId: string): Promise<void> {
    // Fetch the row, swap tee/green, advance rotation by π, mark manual.
    const { data: row, error: fetchErr } = await supabase
      .from('holes')
      .select('tee_lng, tee_lat, green_lng, green_lat, rotation_radians')
      .eq('id', holeId)
      .single();
    if (fetchErr || !row) throw toAppError(fetchErr ?? new Error('Hole not found'));
    const nextRotation =
      row.rotation_radians == null ? null : ((row.rotation_radians + Math.PI) % (2 * Math.PI));
    const { error: updateErr } = await supabase
      .from('holes')
      .update({
        tee_lng: row.green_lng,
        tee_lat: row.green_lat,
        green_lng: row.tee_lng,
        green_lat: row.tee_lat,
        rotation_radians: nextRotation,
        orientation_confidence: 'manual' as OrientationConfidence
      })
      .eq('id', holeId);
    if (updateErr) throw toAppError(updateErr, 'Could not flip hole');
  }
};

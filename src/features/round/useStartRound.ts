import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { courseRepo } from '@/services/courseRepo';
import { roundRepo } from '@/services/roundRepo';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';
import { emptyHoles, useRoundStore } from '@/stores/roundStore';
import type { Course } from '@/models';

export function useCourses() {
  const userId = useAuthStore((s) => s.session?.user.id);
  return useQuery({
    queryKey: ['courses', userId],
    enabled: !!userId,
    queryFn: () => courseRepo.list(userId ?? null)
  });
}

interface StartRoundInput {
  course: {
    id?: string | null;
    name: string;
    teeBox: string | null;
    courseRating: number | null;
    slopeRating: number | null;
    totalPar: number;
    totalYardage: number | null;
    address?: string | null;
    city?: string | null;
    state?: string | null;
    zip?: string | null;
  };
  holesPlayed: number;
  /**
   * Optional ISO timestamp for `started_at`. When omitted, defaults to now —
   * the live-round flow. The Start Round form passes this to backdate a round
   * that was already played on a previous day. The user still enters
   * holes / shots through the normal flow afterward.
   */
  playedAt?: string | null;
}

export function useStartRound() {
  const userId = useAuthStore((s) => s.session?.user.id);
  const startActive = useRoundStore((s) => s.startRound);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ course, holesPlayed, playedAt }: StartRoundInput) => {
      if (!userId) throw new Error('Not authenticated');

      let courseId = course.id ?? null;
      if (!courseId) {
        const created: Course = await courseRepo.create({
          name: course.name,
          tee_box: course.teeBox,
          course_rating: course.courseRating,
          slope_rating: course.slopeRating,
          total_par: course.totalPar,
          total_yardage: course.totalYardage,
          address: course.address ?? null,
          city: course.city ?? null,
          state: course.state ?? null,
          zip: course.zip ?? null,
          created_by_user: userId
        });
        courseId = created.id;
      }

      const startedAt = playedAt ?? new Date().toISOString();
      const round = await roundRepo.create({
        user_id: userId,
        course_id: courseId,
        course_name: course.name,
        holes_played: holesPlayed,
        score: 0,
        par: course.totalPar,
        score_vs_par: 0,
        started_at: startedAt,
        completed_at: null,
        course_rating: course.courseRating,
        slope_rating: course.slopeRating,
        estimated_handicap: null,
        handicap_differential: null
      });

      // Per-hole par. Prefer the OSM-sourced public.holes.par (authoritative
      // per-hole value); fall back to the course-average for any hole that
      // doesn't have OSM data yet. Without this every hole gets the same
      // average par and scoring is wrong on every par-3/par-5 hole — a
      // par-3 played in 3 reads as "+1" because the stored par was an
      // average like 2 or 4 instead of 3.
      const defaultPar = Math.round(course.totalPar / holesPlayed) || 4;
      const osmPars: Record<number, number> = {};
      if (courseId) {
        const { data: osmHoles } = await supabase
          .from('holes')
          .select('hole_number, par')
          .eq('course_id', courseId);
        for (const h of osmHoles ?? []) {
          if (h.par != null) osmPars[h.hole_number] = h.par;
        }
      }
      const holes = emptyHoles(holesPlayed, defaultPar).map((h) => ({
        ...h,
        par: osmPars[h.holeNumber] ?? h.par
      }));

      startActive({
        roundId: round.id,
        userId,
        courseId,
        courseName: round.course_name,
        holesPlayed,
        courseRating: round.course_rating,
        slopeRating: round.slope_rating,
        totalPar: round.par,
        totalYardage: course.totalYardage,
        startedAt: round.started_at,
        currentHoleIndex: 0,
        holes
      });

      // Persist initial blank holes so RLS-bound queries can resolve hole ids.
      const initialHoles = holes.map((h) => ({
        round_id: round.id,
        hole_number: h.holeNumber,
        par: h.par,
        yardage: h.yardage,
        strokes: 0,
        putts: 0,
        penalty_strokes: 0,
        fairway_result: null,
        sand: false,
        gir: false,
        clubs_used: []
      }));
      const persisted = await roundRepo.upsertHoles(initialHoles);
      useRoundStore.getState().applyHoleIds(persisted);

      return round;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rounds', userId] });
      queryClient.invalidateQueries({ queryKey: ['courses', userId] });
    }
  });
}

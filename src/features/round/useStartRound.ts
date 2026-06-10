import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { courseRepo } from '@/services/courseRepo';
import { roundRepo } from '@/services/roundRepo';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';
import { emptyHoles, useRoundStore } from '@/stores/roundStore';
import { tmIntegrationRepo } from '@/services/tmIntegration/tmIntegrationRepo';
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
  /**
   * TournamentManagement linkage. Present only when the round is launched from
   * "My Tournaments". Stamps the TM registration + round number on the round and
   * establishes the scorecard link early via a first /scores call.
   */
  tm?: {
    registrationId: string;
    roundNumber: number;
    tournamentSlug?: string | null;
    startingHole?: number | null;
  };
}

export function useStartRound() {
  const userId = useAuthStore((s) => s.session?.user.id);
  const startActive = useRoundStore((s) => s.startRound);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ course, holesPlayed, playedAt, tm }: StartRoundInput) => {
      if (!userId) throw new Error('Not authenticated');

      // Tournament round: if one is already in progress for this registration +
      // round number, RESUME it (hydrate holes + shots from the DB) instead of
      // creating a duplicate. This is what makes re-entering a tournament round
      // show the holes/shots already recorded rather than a blank new round.
      if (tm) {
        const existing = await roundRepo.findBestTournamentRound(
          userId,
          tm.registrationId,
          tm.roundNumber
        );
        if (existing) {
          const [holes, shots] = await Promise.all([
            roundRepo.listHoles(existing.id),
            roundRepo.listShots(existing.id)
          ]);
          useRoundStore.getState().hydrateFromRemote(existing, holes, shots);
          return existing;
        }
      }

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
        handicap_differential: null,
        tm_registration_id: tm?.registrationId ?? null,
        tm_round_number: tm?.roundNumber ?? null,
        tm_tournament_slug: tm?.tournamentSlug ?? null
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
        holes,
        tmRegistrationId: tm?.registrationId ?? null,
        tmRoundNumber: tm?.roundNumber ?? null,
        tmTournamentSlug: tm?.tournamentSlug ?? null
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

      // Tournament round: establish the TM scorecard link early. We send the
      // starting hole with a null score — enough for TM to create/resolve the
      // scorecard and persist round_tracking_round_id (= our round id) before any
      // real strokes are pushed. Best-effort: a failure here doesn't block play;
      // the first live score push re-establishes the link (resolution falls back
      // to registration_id + round_number).
      if (tm) {
        try {
          await tmIntegrationRepo.pushScores({
            round_tracking_round_id: round.id,
            registration_id: tm.registrationId,
            tournament_slug: tm.tournamentSlug ?? undefined,
            round_number: tm.roundNumber,
            status: 'IN_PROGRESS',
            holes: [{ hole_number: tm.startingHole ?? 1, strokes: null }]
          });
        } catch (err) {
          console.error('[tm] early scorecard link failed', err);
        }
      }

      return round;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rounds', userId] });
      queryClient.invalidateQueries({ queryKey: ['courses', userId] });
    }
  });
}

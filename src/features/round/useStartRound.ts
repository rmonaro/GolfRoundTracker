import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { courseRepo } from '@/services/courseRepo';
import { courseTeesRepo } from '@/services/courseTeesRepo';
import { roundRepo } from '@/services/roundRepo';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';
import { emptyHoles, useRoundStore } from '@/stores/roundStore';
import { tmIntegrationRepo } from '@/services/tmIntegration/tmIntegrationRepo';
import type { Course, Round } from '@/models';
import { cacheCourseInBackground, getCachedCourse } from '@/services/courseCacheRepo';
import { downloadPackInBackground } from '@/services/coursePackRepo';
import { newId } from '@/lib/ids';

export function useCourses() {
  const userId = useAuthStore((s) => s.session?.user.id);
  return useQuery({
    queryKey: ['courses', userId],
    enabled: !!userId,
    queryFn: () => courseRepo.list(userId ?? null)
  });
}

/** Named tee sets for a course, for the round-start tee picker. */
export function useCourseTees(courseId: string | null | undefined) {
  return useQuery({
    queryKey: ['course-tees', courseId],
    enabled: !!courseId,
    queryFn: () => courseTeesRepo.listForCourse(courseId as string)
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
    /** Selected named tee set (migration 029). Null for free-text/manual tees. */
    teeId?: string | null;
    teeName?: string | null;
    /** Per-hole yardage from the selected tee: { [holeNumber]: yards }. */
    teeHoleYardages?: Record<number, number> | null;
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
      // Mint the round id here rather than reading it back from Postgres. This
      // is what decouples starting a round from having a signal.
      const roundId = newId();
      const roundPayload = {
        id: roundId,
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
        tm_tournament_slug: tm?.tournamentSlug ?? null,
        tee_id: course.teeId ?? null,
        tee_name: course.teeName ?? null
      };

      // Per-hole par. Prefer the OSM-sourced public.holes.par (authoritative
      // per-hole value); fall back to the course-average for any hole that
      // doesn't have OSM data yet. Without this every hole gets the same
      // average par and scoring is wrong on every par-3/par-5 hole — a
      // par-3 played in 3 reads as "+1" because the stored par was an
      // average like 2 or 4 instead of 3.
      const defaultPar = Math.round(course.totalPar / holesPlayed) || 4;
      const osmPars: Record<number, number> = {};
      if (courseId) {
        // Cache first: without this a round started with no signal would give
        // every hole the course-average par, which silently corrupts scoring on
        // every par 3 and par 5 for the whole round.
        const cached = await getCachedCourse(courseId);
        if (cached) {
          for (const h of cached.holes) {
            if (h.par != null) osmPars[h.hole_number] = h.par;
          }
        } else {
          const { data: osmHoles } = await supabase
            .from('holes')
            .select('hole_number, par')
            .eq('course_id', courseId);
          for (const h of osmHoles ?? []) {
            if (h.par != null) osmPars[h.hole_number] = h.par;
          }
        }
      }
      // Per-hole yardage from the selected tee set (migration 029), keyed by
      // hole number. Null when no tee was chosen (manual/free-text tee) — the
      // hole keeps its blank yardage and the user can enter it during play.
      const teeYardages = course.teeHoleYardages ?? {};
      const holes = emptyHoles(holesPlayed, defaultPar).map((h) => ({
        ...h,
        par: osmPars[h.holeNumber] ?? h.par,
        yardage: teeYardages[h.holeNumber] ?? h.yardage
      }));

      // Pull the course onto the device now, while we demonstrably have signal
      // (we just created the round). Fire-and-forget — the golfer asked to start
      // a round, not to manage a download, so a failure here must never block or
      // fail that.
      //
      // Two separate payloads, and both matter:
      //   • geometry (~145 KB) — pars, yardages, hole shapes. Keeps scoring and
      //     distance-to-pin working with no signal.
      //   • satellite imagery (~3-45 MB) — without it the map drops to the
      //     schematic SVG, and the aerial is what golfers actually pick a line
      //     from. Skipped automatically when it's already on the device.
      cacheCourseInBackground(courseId);
      downloadPackInBackground(courseId, course.name);

      // LOCAL FIRST. The store is the source of truth from this point; the
      // server is told afterwards, best-effort. Every id involved is already
      // minted, so the golfer can tee off and record shots whether or not the
      // writes below ever land.
      startActive({
        roundId,
        userId,
        courseId,
        courseName: course.name,
        holesPlayed,
        courseRating: course.courseRating,
        slopeRating: course.slopeRating,
        totalPar: course.totalPar,
        totalYardage: course.totalYardage,
        startedAt,
        currentHoleIndex: 0,
        holes,
        tmRegistrationId: tm?.registrationId ?? null,
        tmRoundNumber: tm?.roundNumber ?? null,
        tmTournamentSlug: tm?.tournamentSlug ?? null,
        teeId: course.teeId ?? null,
        teeName: course.teeName ?? null
      });

      const initialHoles = holes.map((h) => ({
        id: h.holeId,
        round_id: roundId,
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

      // Push round + holes. Failure is EXPECTED offline and must not surface as
      // "couldn't start round" — the round exists locally and these are upserts
      // keyed on ids we already hold, so replaying them later is safe.
      // (Phase 5 adds the drain loop that does the replaying.)
      let round: Round | null = null;
      try {
        round = await roundRepo.create(roundPayload);
        const persisted = await roundRepo.upsertHoles(initialHoles);
        // Records that the server now has these rows, so shot saves don't
        // re-upsert their parent hole on every stroke.
        useRoundStore.getState().applyHoleIds(persisted);
      } catch (err) {
        console.warn('[start-round] remote create deferred (offline?)', err);
      }

      // Tournament round: establish the TM scorecard link early. We send the
      // starting hole with a null score — enough for TM to create/resolve the
      // scorecard and persist round_tracking_round_id (= our round id) before any
      // real strokes are pushed. Best-effort: a failure here doesn't block play;
      // the first live score push re-establishes the link (resolution falls back
      // to registration_id + round_number).
      if (tm) {
        try {
          await tmIntegrationRepo.pushScores({
            // The client-minted id, not the server echo — identical by
            // construction, and defined even when the create above didn't land.
            round_tracking_round_id: roundId,
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

      // Fall back to the payload we built when the server never answered. The
      // round genuinely exists — locally, with this exact id — so callers get a
      // real Round rather than null, and offline start looks like online start.
      return round ?? (roundPayload as Round);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rounds', userId] });
      queryClient.invalidateQueries({ queryKey: ['courses', userId] });
    }
  });
}

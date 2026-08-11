import { useMutation, useQueryClient } from '@tanstack/react-query';
import { roundRepo } from '@/services/roundRepo';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';
import { emptyHoles, useRoundStore, type ActiveRound, type LocalHole } from '@/stores/roundStore';
import { tmIntegrationRepo } from '@/services/tmIntegration/tmIntegrationRepo';
import { getCachedCourse } from '@/services/courseCacheRepo';
import { cacheCourseInBackground } from '@/services/courseCacheRepo';
import { downloadPackInBackground } from '@/services/coursePackRepo';
import { newId } from '@/lib/ids';
import type { Course, Round, RoundHole, Shot } from '@/models';
import type { TmAssignedPlayer, TmScorerAssignment } from '@/services/tmIntegration/types';

/** Everyone in the group is playing the same course, so pars are fetched once. */
async function parsForCourse(courseId: string | null): Promise<Record<number, number>> {
  const pars: Record<number, number> = {};
  if (!courseId) return pars;
  // Cache first — a scorekeeper opening a group on the first tee usually has
  // worse signal than the phone that downloaded the course earlier.
  const cached = await getCachedCourse(courseId);
  if (cached) {
    for (const h of cached.holes) if (h.par != null) pars[h.hole_number] = h.par;
    return pars;
  }
  const { data } = await supabase.from('holes').select('hole_number, par').eq('course_id', courseId);
  for (const h of data ?? []) if (h.par != null) pars[h.hole_number] = h.par;
  return pars;
}

function displayName(p: TmAssignedPlayer): string {
  return [p.first_name, p.last_name].filter(Boolean).join(' ').trim() || 'Player';
}

/** Rebuild a scorer's local round from rows already on the server. */
function hydrateRound(
  round: Round,
  holes: RoundHole[],
  shots: Shot[],
  player: TmAssignedPlayer,
  assignment: TmScorerAssignment
): ActiveRound {
  const byHole = new Map<string, LocalHole>();
  const localHoles: LocalHole[] = holes
    .slice()
    .sort((a, b) => a.hole_number - b.hole_number)
    .map((h) => {
      const lh: LocalHole = {
        holeId: h.id,
        syncedAt: round.started_at,
        holeNumber: h.hole_number,
        par: h.par,
        yardage: h.yardage,
        strokes: h.strokes,
        putts: h.putts,
        penaltyStrokes: h.penalty_strokes,
        fairwayResult: h.fairway_result,
        sand: h.sand,
        gir: h.gir,
        clubsUsed: h.clubs_used ?? [],
        shots: [],
        dirty: false
      };
      byHole.set(h.id, lh);
      return lh;
    });

  for (const s of shots.slice().sort((a, b) => a.shot_number - b.shot_number)) {
    const hole = byHole.get(s.hole_id);
    if (!hole) continue;
    hole.shots.push({
      id: s.id,
      shotNumber: s.shot_number,
      clubId: s.club_id,
      shotResult: s.shot_result,
      targetType: s.target_type,
      targetResult: s.target_result,
      lie: s.lie,
      penaltyType: s.penalty_type,
      distance: s.distance,
      distanceUnit: s.distance_unit,
      notes: s.notes,
      createdAt: s.created_at,
      syncedAt: s.created_at,
      verified: s.verified ?? true,
      startLat: s.start_lat,
      startLng: s.start_lng,
      endLat: s.end_lat,
      endLng: s.end_lng,
      calculatedDistance: s.calculated_distance
    });
  }

  return {
    roundId: round.id,
    userId: round.user_id,
    courseId: round.course_id,
    courseName: round.course_name,
    holesPlayed: round.holes_played,
    courseRating: round.course_rating,
    slopeRating: round.slope_rating,
    totalPar: round.par,
    totalYardage: null,
    startedAt: round.started_at,
    currentHoleIndex: 0,
    holes: localHoles,
    roundSyncedAt: round.started_at,
    tmRegistrationId: round.tm_registration_id,
    tmRoundNumber: round.tm_round_number,
    tmTournamentSlug: round.tm_tournament_slug,
    scoringMode: 'MARKER',
    scoredByUserId: round.scored_by_user_id ?? round.user_id,
    athleteName: displayName(player),
    pendingAthleteEmail: player.grt_athlete_id ? null : (player.email ?? null),
    teeGroupId: assignment.tee_group_id
  };
}

interface OpenGroupInput {
  assignment: TmScorerAssignment;
  course: Course;
}

/**
 * Open a tee group for scoring: one live round per player, resumed when the
 * scorer already started them.
 *
 * The first player lands on screen and the rest are parked (see roundStore).
 * Every round is owned by the SCOREKEEPER while tracking — that's the ownership
 * model in migration 034, and it's what lets the existing offline reconciler
 * push all of them without a single new write policy.
 */
export function useScorerGroupRounds() {
  const userId = useAuthStore((s) => s.session?.user.id);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ assignment, course }: OpenGroupInput) => {
      if (!userId) throw new Error('Not authenticated');

      const roundNumber = assignment.round_number;
      const holesPlayed = 18;
      const pars = await parsForCourse(course.id);
      const defaultPar = Math.round((course.total_par ?? 72) / holesPlayed) || 4;

      // Pull the course onto the device now, while we demonstrably have signal.
      // Fire-and-forget: the scorer asked to open a group, not to manage a
      // download, so a failure here must never block it.
      cacheCourseInBackground(course.id);
      downloadPackInBackground(course.id, course.name);

      const opened: ActiveRound[] = [];

      for (const player of assignment.players) {
        // Resume rather than duplicate. Scoped to this scorer because they own
        // every marker round they've written.
        // eslint-disable-next-line no-await-in-loop
        const existing = await roundRepo
          .findBestTournamentRound(userId, player.registration_id, roundNumber)
          .catch(() => null);

        if (existing) {
          // eslint-disable-next-line no-await-in-loop
          const [holes, shots] = await Promise.all([
            roundRepo.listHoles(existing.id),
            roundRepo.listShots(existing.id)
          ]);
          opened.push(hydrateRound(existing, holes, shots, player, assignment));
          continue;
        }

        const roundId = newId();
        const startedAt = new Date().toISOString();
        const holes = emptyHoles(holesPlayed, defaultPar).map((h) => ({
          ...h,
          par: pars[h.holeNumber] ?? h.par
        }));

        const local: ActiveRound = {
          roundId,
          // The SCOREKEEPER owns the row while tracking. Ownership transfers to
          // the athlete when the card is finished (phase 5).
          userId,
          courseId: course.id,
          courseName: course.name,
          holesPlayed,
          courseRating: course.course_rating,
          slopeRating: course.slope_rating,
          totalPar: course.total_par ?? 72,
          totalYardage: course.total_yardage,
          startedAt,
          currentHoleIndex: Math.max(0, (assignment.starting_hole ?? 1) - 1),
          holes,
          tmRegistrationId: player.registration_id,
          tmRoundNumber: roundNumber,
          tmTournamentSlug: assignment.tournament.slug,
          scoringMode: 'MARKER',
          scoredByUserId: userId,
          athleteName: displayName(player),
          // No GRT account yet → the card is claimed later, by email.
          pendingAthleteEmail: player.grt_athlete_id ? null : (player.email ?? null),
          teeGroupId: assignment.tee_group_id
        };
        opened.push(local);

        // Best-effort remote create. Failure is EXPECTED offline: every id is
        // already minted, so the reconciler replays this later as an upsert.
        try {
          // eslint-disable-next-line no-await-in-loop
          await roundRepo.create({
            id: roundId,
            user_id: userId,
            course_id: course.id,
            course_name: course.name,
            holes_played: holesPlayed,
            score: 0,
            par: course.total_par ?? 72,
            score_vs_par: 0,
            started_at: startedAt,
            completed_at: null,
            course_rating: course.course_rating,
            slope_rating: course.slope_rating,
            estimated_handicap: null,
            handicap_differential: null,
            tm_registration_id: player.registration_id,
            tm_round_number: roundNumber,
            tm_tournament_slug: assignment.tournament.slug,
            tee_id: null,
            tee_name: null,
            scoring_mode: 'MARKER',
            scored_by_user_id: userId,
            pending_athlete_email: local.pendingAthleteEmail,
            pending_registration_id: player.registration_id
          });
          // eslint-disable-next-line no-await-in-loop
          const persisted = await roundRepo.upsertHoles(
            holes.map((h) => ({
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
            }))
          );
          for (const h of persisted) {
            const match = holes.find((x) => x.holeNumber === h.hole_number);
            if (match) {
              match.holeId = h.id;
              match.syncedAt = new Date().toISOString();
            }
          }
          local.roundSyncedAt = new Date().toISOString();
        } catch (err) {
          console.warn('[scorer] remote create deferred (offline?)', player.registration_id, err);
        }

        // Establish the TM scorecard link early, so the leaderboard can attach
        // this card before any real strokes are pushed. Best-effort.
        try {
          // eslint-disable-next-line no-await-in-loop
          await tmIntegrationRepo.pushScores({
            round_tracking_round_id: roundId,
            registration_id: player.registration_id,
            tournament_slug: assignment.tournament.slug,
            round_number: roundNumber,
            status: 'IN_PROGRESS',
            holes: [{ hole_number: assignment.starting_hole ?? 1, strokes: null }]
          });
        } catch (err) {
          console.error('[scorer] early scorecard link failed', player.registration_id, err);
        }
      }

      if (!opened.length) throw new Error('This tee group has no players to score.');

      // First player on screen, the rest parked.
      const store = useRoundStore.getState();
      store.startRound(opened[0]);
      for (const r of opened.slice(1)) store.addParallelRound(r);

      return opened;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rounds', userId] });
    }
  });
}

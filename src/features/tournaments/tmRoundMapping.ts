import type { LocalHole } from '@/stores/roundStore';
import type { BagClub } from '@/models';
import { abbreviateClubName } from '@/features/bag/abbreviateClubName';
import { holeTotalScore } from '@/features/round/computeRoundTotals';
import type { TmScoreHole, TmShot } from '@/services/tmIntegration/types';

/** Readable club label for a TM shot, e.g. "7I", "Driver", custom nickname. */
function clubLabel(clubId: string | null, bagClubs: BagClub[]): string | null {
  if (!clubId) return null;
  const club = bagClubs.find((c) => c.clubId === clubId);
  if (!club) return null;
  const name = club.customName?.trim() || club.name;
  return abbreviateClubName(name, club.category);
}

/** A hole has been played once it has any logged shot or penalty. */
export function holeWasPlayed(hole: LocalHole): boolean {
  return hole.shots.length > 0 || (hole.penaltyStrokes ?? 0) > 0;
}

/**
 * Map a GRT hole to TM's score-hole shape. `strokes` is the gross hole score
 * (shots + stroke penalties) — the same value the round summary shows — and
 * `putts` is the putter-shot subset already derived onto the hole.
 */
export function toScoreHole(hole: LocalHole): TmScoreHole {
  return {
    hole_number: hole.holeNumber,
    strokes: holeTotalScore(hole),
    putts: hole.putts ?? 0,
    par: hole.par
  };
}

/**
 * Map a GRT hole's shots to TM shots for the public replay. Landing position is
 * the shot's GPS end point; distance is normalised to yards (putts are stored in
 * feet). Shots are emitted in play order regardless of GPS so the replay shows a
 * complete sequence even when a fix was missing.
 */
export function toShotPayloads(hole: LocalHole, bagClubs: BagClub[]): TmShot[] {
  return hole.shots
    .slice()
    .sort((a, b) => a.shotNumber - b.shotNumber)
    .map((s) => {
      const distanceYards =
        s.distance == null
          ? null
          : s.distanceUnit === 'feet'
            ? Math.round(s.distance / 3)
            : Math.round(s.distance);
      return {
        sequence: s.shotNumber,
        lat: s.endLat ?? null,
        lng: s.endLng ?? null,
        club: clubLabel(s.clubId, bagClubs),
        distance_yards: distanceYards,
        result: s.shotResult ?? null
      };
    });
}

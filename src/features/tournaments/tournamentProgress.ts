import type { RoundRow } from '@/types/database';
import type { TmRound } from '@/services/tmIntegration/types';

/**
 * The locally-recorded GRT round for a given TM registration + round number, or
 * null if the player hasn't started it on this device. When duplicates exist
 * (an old empty round, a re-entry race), a completed round wins; otherwise the
 * most recently started one.
 */
export function localRoundFor(
  localRounds: RoundRow[] | undefined,
  registrationId: string,
  roundNumber: number
): RoundRow | null {
  const matches = (localRounds ?? []).filter(
    (r) => r.tm_registration_id === registrationId && r.tm_round_number === roundNumber
  );
  if (matches.length === 0) return null;
  const completed = matches.filter((r) => r.completed_at);
  const pool = completed.length ? completed : matches;
  return [...pool].sort((a, b) => b.started_at.localeCompare(a.started_at))[0];
}

/**
 * A tournament round is DONE when the locally-recorded round is completed, OR TM
 * has locked the scorecard. The local signal is authoritative because the final
 * SUBMITTED push to TM is best-effort and can lag/fail — without this, a
 * finished round still reads as "resume" and re-starts from scratch.
 */
export function isTmRoundComplete(round: TmRound, localRound: RoundRow | null): boolean {
  return !!localRound?.completed_at || round.scorecard?.status === 'SUBMITTED';
}

/** Round has been started locally but isn't finished — i.e. it's resumable. */
export function isTmRoundInProgress(round: TmRound, localRound: RoundRow | null): boolean {
  if (isTmRoundComplete(round, localRound)) return false;
  return (localRound != null && !localRound.completed_at) || round.scorecard?.status === 'IN_PROGRESS';
}

/** Signed score-to-par label (E / +N / -N), null when unknown. */
export function fmtToPar(n: number | null | undefined): string | null {
  if (n == null) return null;
  return n === 0 ? 'E' : n > 0 ? `+${n}` : `${n}`;
}

export interface TournamentAccess {
  /** The user has something on the tournament side — an event, or a group to score. */
  hasAccess: boolean;
  /** Still deciding. Callers must wait rather than read `hasAccess: false` as "no". */
  isResolving: boolean;
  /**
   * Every source failed with no snapshot to fall back on, so `hasAccess: false`
   * means "unknown", not "no". Callers that would hide a way ONTO the tournament
   * side should keep it visible in this case.
   */
  isUnknown: boolean;
  tournamentCount: number;
  scorerGroupCount: number;
}

export interface AccessSignals {
  /** A session is present. Queries keyed on the user id can't be trusted without it. */
  hasUser: boolean;
  tournamentCount: number;
  scorerGroupCount: number;
  /** The LIVE entitlements pull has settled — succeeded or failed. */
  tournamentsSettled: boolean;
  /** The LIVE scorer-assignments pull has settled — succeeded or failed. */
  scorerSettled: boolean;
  /** Live entitlements failed AND no cached snapshot existed. */
  tournamentsUnavailable: boolean;
  /** Live scorer pull failed AND no cached snapshot existed. */
  scorerUnavailable: boolean;
}

/**
 * Decides whether a user has a tournament side, from the state of the two live
 * pulls that can prove it.
 *
 * The rule that matters: an empty result only counts once the LIVE query behind
 * it has settled. Cached snapshots may resolve instantly and empty (cold cache
 * on a fresh login), and treating that as an answer sends a player who really
 * does have events straight past the chooser into the rounds-only app.
 *
 * Access is granted the moment either source says yes — no reason to hold
 * someone with an obvious event on the slower query.
 */
export function resolveTournamentAccess(s: AccessSignals): TournamentAccess {
  const hasAccess = s.tournamentCount > 0 || s.scorerGroupCount > 0;
  const isResolving = !hasAccess && (!s.hasUser || !s.tournamentsSettled || !s.scorerSettled);
  const isUnknown =
    !hasAccess && !isResolving && (s.tournamentsUnavailable || s.scorerUnavailable);

  return {
    hasAccess,
    isResolving,
    isUnknown,
    tournamentCount: s.tournamentCount,
    scorerGroupCount: s.scorerGroupCount
  };
}

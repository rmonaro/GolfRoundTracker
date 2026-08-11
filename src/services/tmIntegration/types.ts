// Shapes returned by the TournamentManagement (TM) integration API, as relayed
// through our `tm-integration` edge function. These mirror the contract in
// docs/TM_INTEGRATION.md; only the fields GRT actually consumes are typed.

export type CanStartReason = 'ok' | 'before_tee_time' | 'no_tee_time';
export type TmScorecardStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'SUBMITTED' | string;

export interface TmRoundScorecard {
  id: string;
  round_tracking_round_id: string | null;
  status: TmScorecardStatus;
  gross_total: number | null;
  to_par: number | null;
  holes_completed: number | null;
}

export interface TmRound {
  round_number: number;
  tee_time: string | null;
  starting_hole: number | null;
  can_start: boolean;
  can_start_reason: CanStartReason;
  scorecard: TmRoundScorecard | null;
}

export interface TmTournamentInfo {
  id: string;
  name: string;
  slug: string;
  status: string;
  number_rounds: number;
  start_date: string | null;
  end_date: string | null;
  external_course_id: string | null;
  course_name: string | null;
}

export interface TmTournamentEntry {
  registration_id: string;
  registration_status: string;
  tournament: TmTournamentInfo;
  division: { id: string; name: string } | null;
  rounds: TmRound[];
}

export interface TmEntitlements {
  player: { email: string | null; grt_athlete_id: string | null };
  tournaments: TmTournamentEntry[];
}

export interface TmLinkResult {
  linked: number;
  registrations: Array<{ id: string; tournament_id: string; status: string }>;
}

// --- Scorer mode (docs/SCORER_MODE.md) -------------------------------------

/** One of the 2-4 players in a tee group the signed-in user is scoring. */
export interface TmAssignedPlayer {
  registration_id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  /**
   * Null when this player has never opened GRT. They can still be tracked —
   * the round is attributed by registration_id and claimed by the athlete
   * later, by email.
   */
  grt_athlete_id: string | null;
  registration_status: string;
  division: { id: string; name: string } | null;
  position: number;
  scorecard: TmRoundScorecard | null;
}

/** A tee group the signed-in user has been assigned to score. */
export interface TmScorerAssignment {
  tee_group_id: string;
  tee_group_name: string | null;
  round_number: number;
  tee_time: string | null;
  starting_hole: number | null;
  can_start: boolean;
  can_start_reason: CanStartReason;
  tournament: TmTournamentInfo;
  players: TmAssignedPlayer[];
}

export interface TmScorerAssignments {
  scorer: { email: string | null; grt_user_id: string | null };
  assignments: TmScorerAssignment[];
}

export interface TmTransferResult {
  /** Cards handed to a linked athlete. */
  transferred: number;
  /** Cards left with the scorer because the athlete has no GRT account yet. */
  pending: number;
  errors: string[];
}

// --- Outbound push payloads (client → edge fn → TM) ------------------------

export interface TmScoreHole {
  hole_number: number;
  strokes?: number | null;
  putts?: number | null;
  par?: number;
}

export interface TmScorePush {
  round_tracking_round_id?: string;
  registration_id?: string;
  tournament_slug?: string;
  round_number: number;
  status?: 'IN_PROGRESS' | 'SUBMITTED';
  holes: TmScoreHole[];
}

export interface TmShot {
  sequence: number;
  lat?: number | null;
  lng?: number | null;
  club?: string | null;
  distance_yards?: number | null;
  result?: string | null;
}

export interface TmShotsPush {
  round_tracking_round_id?: string;
  registration_id?: string;
  tournament_slug?: string;
  round_number: number;
  holes: Array<{ hole_number: number; shots: TmShot[] }>;
}

export interface TmScorecardResult {
  scorecard: {
    id: string;
    round_number: number;
    status: TmScorecardStatus;
    gross_total: number | null;
    to_par: number | null;
    holes_completed: number | null;
    round_tracking_round_id: string | null;
    scoring_source: string | null;
  };
}

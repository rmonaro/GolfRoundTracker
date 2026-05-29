// Supabase database type definitions. Hand-written to match the SQL schema in /supabase/schema.sql.
// Once `supabase gen types typescript` is wired in CI this can be replaced with generated types.

export type ClubCategory = 'driver' | 'wood' | 'hybrid' | 'iron' | 'wedge' | 'putter';
export type DominantHand = 'right' | 'left';
export type SkillLevel = 'beginner' | 'average' | 'good' | 'advanced' | 'pga_tour';
export type Gender = 'male' | 'female';
export type FairwayResult = 'hit' | 'left' | 'right' | 'short' | 'long' | 'na';
export type DistanceUnit = 'yards' | 'feet';

export type TargetType = 'green' | 'fairway' | 'putt';
export type TargetResult = 'hit' | 'left' | 'right' | 'short' | 'long' | 'made' | 'missed';
export type Lie = 'fairway' | 'rough' | 'bunker' | 'green' | 'penalty' | 'fringe';
export type PenaltyType =
  | 'ob'
  | 'water'
  | 'lost_ball'
  | 'unplayable'
  | 'wrong_ball'
  | 'bunker';

/**
 * V1 shot results. Note `recovery` is preserved as an enum value for legacy
 * rows but is no longer exposed in the V1 add-shot UI.
 */
export type ShotResult =
  | 'fairway'
  | 'rough'
  | 'sand'
  | 'green'
  | 'penalty'
  | 'recovery'
  | 'left'
  | 'right'
  | 'short'
  | 'long'
  | 'putt'
  | 'made_putt';

export interface ProfileRow {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string;
  handicap_goal: number | null;
  dominant_hand: DominantHand | null;
  skill_level: SkillLevel | null;
  gender: Gender | null;
  is_admin: boolean;
  created_at: string;
}

export interface ClubRow {
  id: string;
  name: string;
  category: ClubCategory;
}

export interface UserBagRow {
  id: string;
  user_id: string;
  club_id: string;
  custom_name: string | null;
  brand: string | null;
  model: string | null;
  loft: number | null;
  typical_distance_yards: number | null;
  order_position: number;
}

export type CourseSource = 'user' | 'api';
export type CourseOsmStatus = 'pending' | 'synced' | 'no_coverage' | 'failed' | 'skip';

export interface CourseRow {
  id: string;
  name: string;
  tee_box: string | null;
  course_rating: number | null;
  slope_rating: number | null;
  total_par: number | null;
  total_yardage: number | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  // Course library (migration 007)
  course_api_id: string | null;
  club_name: string | null;
  country: string | null;
  lat: number | null;
  lng: number | null;
  search_radius: number | null;
  scorecard_external: Record<string, unknown> | null;
  osm_synced_at: string | null;
  osm_status: CourseOsmStatus | null;
  osm_error: string | null;
  source: CourseSource | null;
  created_by_user: string | null;
}

export type OrientationConfidence = 'confirmed' | 'reversed' | 'assumed' | 'manual';

export interface HoleRow {
  id: string;
  course_id: string;
  hole_number: number;
  par: number | null;
  tee_lng: number | null;
  tee_lat: number | null;
  green_lng: number | null;
  green_lat: number | null;
  rotation_radians: number | null;
  orientation_confidence: OrientationConfidence | null;
  bbox_min_lng: number | null;
  bbox_min_lat: number | null;
  bbox_max_lng: number | null;
  bbox_max_lat: number | null;
  centerline: Array<[number, number]> | null;
  centerline_distance_m: number | null;
  straight_distance_m: number | null;
}

/** Single coordinate pair as [lng, lat] — same convention as OSM/GeoJSON. */
export type LngLat = [number, number];

/** A polygon is one or more rings; first is outer, rest are holes. A linestring is a ring of points. */
export type FeatureCoords = LngLat[] | LngLat[][];

export interface HoleFeatureRow {
  id: string;
  course_id: string;
  hole_id: string | null;
  osm_id: number | null;
  /** e.g. fairway, green, bunker, water, tee, rough, hole_line */
  feature_type: string;
  is_line: boolean;
  coords: FeatureCoords;
  created_at: string;
}

export interface RoundRow {
  id: string;
  user_id: string;
  course_id: string | null;
  course_name: string;
  holes_played: number;
  score: number;
  par: number;
  score_vs_par: number;
  started_at: string;
  completed_at: string | null;
  course_rating: number | null;
  slope_rating: number | null;
  estimated_handicap: number | null;
  handicap_differential: number | null;
}

export interface RoundHoleRow {
  id: string;
  round_id: string;
  hole_number: number;
  par: number;
  yardage: number | null;
  strokes: number;
  putts: number;
  fairway_result: FairwayResult | null;
  sand: boolean;
  gir: boolean;
  penalty_strokes: number;
  clubs_used: string[];
}

export interface ShotRow {
  id: string;
  round_id: string;
  hole_id: string;
  shot_number: number;
  club_id: string | null;
  /** Legacy single-field outcome, kept populated for backwards compatibility. */
  shot_result: ShotResult;
  /** Structured outcome (V1 migration 005). */
  target_type: TargetType | null;
  target_result: TargetResult | null;
  lie: Lie | null;
  penalty_type: PenaltyType | null;
  distance: number | null;
  distance_unit: DistanceUnit | null;
  notes: string | null;
  // V2 GPS — nullable until the GPS flow ships
  start_lat: number | null;
  start_lng: number | null;
  end_lat: number | null;
  end_lng: number | null;
  calculated_distance: number | null;
  created_at: string;
}

export interface Database {
  public: {
    Tables: {
      profiles: { Row: ProfileRow; Insert: Partial<ProfileRow> & { id: string; email: string }; Update: Partial<ProfileRow> };
      clubs: { Row: ClubRow; Insert: Omit<ClubRow, 'id'> & { id?: string }; Update: Partial<ClubRow> };
      user_bag: { Row: UserBagRow; Insert: Omit<UserBagRow, 'id'> & { id?: string }; Update: Partial<UserBagRow> };
      courses: { Row: CourseRow; Insert: Omit<CourseRow, 'id'> & { id?: string }; Update: Partial<CourseRow> };
      rounds: { Row: RoundRow; Insert: Omit<RoundRow, 'id'> & { id?: string }; Update: Partial<RoundRow> };
      round_holes: { Row: RoundHoleRow; Insert: Omit<RoundHoleRow, 'id'> & { id?: string }; Update: Partial<RoundHoleRow> };
      shots: { Row: ShotRow; Insert: Omit<ShotRow, 'id' | 'created_at'> & { id?: string; created_at?: string }; Update: Partial<ShotRow> };
    };
  };
}

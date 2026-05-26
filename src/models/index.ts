export type {
  ClubCategory,
  DominantHand,
  DistanceUnit,
  FairwayResult,
  ShotResult,
  TargetType,
  TargetResult,
  Lie,
  PenaltyType,
  CourseSource,
  CourseOsmStatus,
  OrientationConfidence,
  LngLat,
  FeatureCoords,
  ProfileRow as Profile,
  ClubRow as Club,
  UserBagRow as UserBagClub,
  CourseRow as Course,
  RoundRow as Round,
  RoundHoleRow as RoundHole,
  ShotRow as Shot,
  HoleRow as CourseHole,
  HoleFeatureRow as HoleFeature
} from '@/types/database';

export const FAIRWAY_OPTIONS = ['hit', 'left', 'right', 'short', 'long', 'na'] as const;
export const SHOT_RESULT_OPTIONS = [
  'fairway',
  'rough',
  'green',
  'sand',
  'left',
  'right',
  'short',
  'long',
  'penalty',
  'putt',
  'made_putt'
] as const;
export const CLUB_CATEGORY_OPTIONS = ['driver', 'wood', 'hybrid', 'iron', 'wedge', 'putter'] as const;
export const DISTANCE_UNIT_OPTIONS = ['yards', 'feet'] as const;
export const LIE_OPTIONS = ['fairway', 'rough', 'bunker', 'green', 'penalty', 'fringe'] as const;
export const PENALTY_TYPE_OPTIONS = [
  'ob',
  'water',
  'lost_ball',
  'unplayable',
  'wrong_ball',
  'bunker'
] as const;

/** Penalty types that ADD a stroke to the hole score. Bunker is a tag only — no stroke. */
export const STROKE_PENALTY_TYPES = ['ob', 'water', 'lost_ball', 'unplayable', 'wrong_ball'] as const;

export interface BagClub {
  bagId: string;
  clubId: string;
  name: string;
  category: import('@/types/database').ClubCategory;
  customName: string | null;
  brand: string | null;
  model: string | null;
  loft: number | null;
  orderPosition: number;
}

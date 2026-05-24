import type { ClubCategory } from '@/models';

export interface DefaultClub {
  name: string;
  category: ClubCategory;
}

/**
 * Default set seeded into the user's bag when they first sign up.
 * Order here is the order of clubs in the bag.
 */
export const DEFAULT_BAG: DefaultClub[] = [
  { name: 'Driver', category: 'driver' },
  { name: '3 Wood', category: 'wood' },
  { name: '5 Wood', category: 'wood' },
  { name: '3 Hybrid', category: 'hybrid' },
  { name: '4 Hybrid', category: 'hybrid' },
  { name: '3 Iron', category: 'iron' },
  { name: '4 Iron', category: 'iron' },
  { name: '5 Iron', category: 'iron' },
  { name: '6 Iron', category: 'iron' },
  { name: '7 Iron', category: 'iron' },
  { name: '8 Iron', category: 'iron' },
  { name: '9 Iron', category: 'iron' },
  { name: 'PW', category: 'wedge' },
  { name: 'GW', category: 'wedge' },
  { name: 'SW', category: 'wedge' },
  { name: 'LW', category: 'wedge' },
  { name: 'Putter', category: 'putter' }
];

export const CATEGORY_LABELS: Record<ClubCategory, string> = {
  driver: 'Driver',
  wood: 'Fairway Wood',
  hybrid: 'Hybrid',
  iron: 'Iron',
  wedge: 'Wedge',
  putter: 'Putter'
};

// The drill registry — the single seam for adding drills. A new drill is a new
// definition file plus one entry in this array; no new screen, no runner change.

import type { DrillCategory, DrillDefinition } from './types';
import { gappingDrill } from './gapping';
import { targetProximityDrill } from './targetProximity';
import { randomizedRotationDrill } from './randomizedRotation';

export const DRILLS: DrillDefinition[] = [gappingDrill, targetProximityDrill, randomizedRotationDrill];

export function getDrill(id: string | null | undefined): DrillDefinition | null {
  if (!id) return null;
  return DRILLS.find((d) => d.id === id) ?? null;
}

/** Human label + ordering for the picker's category groups. */
export const CATEGORY_META: Record<DrillCategory, { label: string; order: number; blurb: string }> = {
  foundation: { label: 'Foundation', order: 0, blurb: 'Build your baseline.' },
  skill: { label: 'Skill', order: 1, blurb: 'Sharpen a specific ability.' },
  transfer: { label: 'Transfer', order: 2, blurb: 'Practice that carries to the course.' }
};

export type { DrillDefinition } from './types';

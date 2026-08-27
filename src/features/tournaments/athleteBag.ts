import { bagRepo } from '@/services/bagRepo';
import type { BagClub } from '@/models';
import type { TmAssignedPlayer } from '@/services/tmIntegration/types';

/**
 * The bag to offer a scorekeeper for one player.
 *
 * Prefer the athlete's real bag — their club names and their own typical carry
 * distances, which is what makes the distance-based club suggestion mean
 * anything. Readable thanks to the scorer policy in migration 035.
 *
 * Falls back to the standard club catalog when the player has no GRT account,
 * has never set a bag up, or the policy isn't in place yet. That fallback is
 * not optional: a scorer must always be able to name the club, and plenty of
 * juniors are tracked without ever having installed the app. Catalog clubs
 * carry no distances, so the suggestion goes quiet rather than guessing.
 *
 * What it deliberately NEVER falls back to is the scorekeeper's own bag —
 * that would put their clubs and their yardages on somebody else's card.
 */
export async function bagForPlayer(player: TmAssignedPlayer): Promise<BagClub[]> {
  if (player.grt_athlete_id) {
    try {
      const bag = await bagRepo.listBag(player.grt_athlete_id);
      if (bag.length > 0) return bag;
    } catch (err) {
      console.warn('[scorer] could not read athlete bag', player.registration_id, err);
    }
  }
  return catalogBag();
}

/** Every club in the catalog, as a bag with no distances. */
export async function catalogBag(): Promise<BagClub[]> {
  try {
    const catalog = await bagRepo.listClubs();
    return catalog.map((c, i) => ({
      bagId: `catalog-${c.id}`,
      clubId: c.id,
      name: c.name,
      category: c.category,
      customName: null,
      brand: null,
      model: null,
      loft: null,
      typicalDistanceYards: null,
      orderPosition: i
    }));
  } catch (err) {
    console.warn('[scorer] could not read club catalog', err);
    return [];
  }
}

/** True when this bag is the catalog stand-in rather than a real one. */
export function isCatalogBag(bag: BagClub[] | undefined): boolean {
  return !!bag?.length && bag.every((c) => c.bagId.startsWith('catalog-'));
}

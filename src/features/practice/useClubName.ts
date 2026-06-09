import { useCallback } from 'react';
import { useBagStore } from '@/stores/bagStore';

/**
 * Returns a resolver that maps a swing's stored `clubId` to a display name
 * using the user's current bag. Falls back to "No club" (null) or "Club"
 * (a club no longer in the bag) so the UI never shows a raw id.
 */
export function useClubNameLookup() {
  const bag = useBagStore((s) => s.clubs);
  return useCallback(
    (clubId: string | null | undefined): string => {
      if (!clubId) return 'No club';
      const c = bag.find((b) => b.clubId === clubId);
      return c ? c.customName || c.name : 'Club';
    },
    [bag]
  );
}

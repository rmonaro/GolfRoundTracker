import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Courses the golfer has starred, so their home track sits at the top of the
 * picker regardless of where they happen to be standing.
 *
 * Stored on the device rather than in Postgres, deliberately. The picker is the
 * screen a golfer opens in a parking lot with one bar of signal, so it has to
 * work with no network; and this is a display preference, not data — losing it
 * on a new device costs one tap to re-star. Everything reads through this
 * store's interface, so moving it behind a `course_favorites` table later is a
 * change to this file plus a sync effect, not to the screens.
 *
 * Persisted as an array because `Set` isn't JSON-serialisable; the in-memory
 * shape stays a Set so membership checks in a list render are O(1).
 */
interface CourseFavoritesState {
  favoriteIds: Set<string>;
  isFavorite: (courseId: string) => boolean;
  toggleFavorite: (courseId: string) => void;
}

export const useCourseFavoritesStore = create<CourseFavoritesState>()(
  persist(
    (set, get) => ({
      favoriteIds: new Set<string>(),
      isFavorite: (courseId) => get().favoriteIds.has(courseId),
      toggleFavorite: (courseId) =>
        set((s) => {
          // New Set identity, or subscribers re-render off a mutated reference
          // that compares equal and nothing updates.
          const next = new Set(s.favoriteIds);
          if (next.has(courseId)) next.delete(courseId);
          else next.add(courseId);
          return { favoriteIds: next };
        })
    }),
    {
      name: 'grt-course-favorites',
      // Sets don't survive JSON, so the persisted shape is an array and the
      // Set is rebuilt on rehydrate.
      partialize: (s) => ({ favoriteIds: [...s.favoriteIds] }) as unknown as CourseFavoritesState,
      merge: (persisted, current) => {
        const raw = (persisted as { favoriteIds?: unknown } | undefined)?.favoriteIds;
        return {
          ...current,
          favoriteIds: new Set(Array.isArray(raw) ? (raw as string[]) : [])
        };
      }
    }
  )
);

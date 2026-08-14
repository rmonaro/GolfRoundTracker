import { useQuery } from '@tanstack/react-query';
import { roundRepo } from '@/services/roundRepo';

type RoundHoles = Awaited<ReturnType<typeof roundRepo.listHoles>>;

/**
 * Every completed round's holes, keyed by round id — the input the fairway, GIR
 * and putts aggregates need.
 *
 * Home and Stats deliberately share this exact query key: both screens want the
 * same rows, and the fetch is one request per completed round, so a second cache
 * entry would double a cost that already grows with the user's history.
 */
export function useRoundHoles(completedIds: string[]) {
  return useQuery({
    queryKey: ['stats-holes', completedIds],
    enabled: completedIds.length > 0,
    queryFn: async () => {
      const all = await Promise.all(completedIds.map((id) => roundRepo.listHoles(id)));
      const map = new Map<string, RoundHoles>();
      completedIds.forEach((id, idx) => map.set(id, all[idx]));
      return map;
    }
  });
}

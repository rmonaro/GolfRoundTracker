import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { roundRepo } from '@/services/roundRepo';
import { useAuthStore } from '@/stores/authStore';
import { useStatsStore } from '@/stores/statsStore';

export function useRounds() {
  const userId = useAuthStore((s) => s.session?.user.id);
  const setRounds = useStatsStore((s) => s.setRounds);

  const query = useQuery({
    queryKey: ['rounds', userId],
    enabled: !!userId,
    queryFn: () => (userId ? roundRepo.listForUser(userId) : Promise.resolve([]))
  });

  useEffect(() => {
    if (query.data) setRounds(query.data);
  }, [query.data, setRounds]);

  return query;
}

export function useRoundDetails(roundId: string | undefined) {
  return useQuery({
    queryKey: ['round-detail', roundId],
    enabled: !!roundId,
    queryFn: async () => {
      if (!roundId) return null;
      const [round, holes, shots] = await Promise.all([
        roundRepo.getById(roundId),
        roundRepo.listHoles(roundId),
        roundRepo.listShots(roundId)
      ]);
      return round ? { round, holes, shots } : null;
    }
  });
}

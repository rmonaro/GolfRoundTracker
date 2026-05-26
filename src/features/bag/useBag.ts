import { useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { bagRepo } from '@/services/bagRepo';
import { useAuthStore } from '@/stores/authStore';
import { useBagStore } from '@/stores/bagStore';
import type { BagClub, ClubCategory } from '@/models';

export function useBag() {
  const userId = useAuthStore((s) => s.session?.user.id);
  const setLocalBag = useBagStore((s) => s.setClubs);
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['bag', userId],
    enabled: !!userId,
    queryFn: () => (userId ? bagRepo.listBag(userId) : Promise.resolve([]))
  });

  useEffect(() => {
    if (query.data) setLocalBag(query.data);
  }, [query.data, setLocalBag]);

  const addClub = useMutation({
    mutationFn: async (input: {
      name: string;
      category: ClubCategory;
      brand?: string | null;
      model?: string | null;
      loft?: number | null;
      typicalDistanceYards?: number | null;
    }) => {
      if (!userId) throw new Error('Not authenticated');
      const club = await bagRepo.createClub(input.name.trim(), input.category);
      const next = query.data?.length ?? 0;
      await bagRepo.addToBag(userId, club.id, next, {
        brand: input.brand ?? null,
        model: input.model ?? null,
        loft: input.loft ?? null,
        typicalDistanceYards: input.typicalDistanceYards ?? null
      });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['bag', userId] })
  });

  const editBagClub = useMutation({
    mutationFn: async (input: {
      bagId: string;
      customName?: string | null;
      brand?: string | null;
      model?: string | null;
      loft?: number | null;
      typicalDistanceYards?: number | null;
      /** If supplied, creates a fresh clubs row with this name+category and re-links user_bag.club_id. */
      newClub?: { name: string; category: ClubCategory };
    }) => {
      const patch: {
        custom_name?: string | null;
        brand?: string | null;
        model?: string | null;
        loft?: number | null;
        typical_distance_yards?: number | null;
        club_id?: string;
      } = {};
      if ('customName' in input) patch.custom_name = input.customName ?? null;
      if ('brand' in input) patch.brand = input.brand ?? null;
      if ('model' in input) patch.model = input.model ?? null;
      if ('loft' in input) patch.loft = input.loft ?? null;
      if ('typicalDistanceYards' in input)
        patch.typical_distance_yards = input.typicalDistanceYards ?? null;
      if (input.newClub) {
        const club = await bagRepo.createClub(input.newClub.name, input.newClub.category);
        patch.club_id = club.id;
      }
      await bagRepo.updateBagClub(input.bagId, patch);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['bag', userId] })
  });

  const quickAdd = useMutation({
    mutationFn: async (clubs: Array<{ name: string; category: ClubCategory }>) => {
      if (!userId) throw new Error('Not authenticated');
      let position = query.data?.length ?? 0;
      for (const { name, category } of clubs) {
        const club = await bagRepo.createClub(name, category);
        await bagRepo.addToBag(userId, club.id, position);
        position++;
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['bag', userId] })
  });

  const clearBag = useMutation({
    mutationFn: async () => {
      if (!userId) throw new Error('Not authenticated');
      await bagRepo.clearBag(userId);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['bag', userId] })
  });

  const removeClub = useMutation({
    mutationFn: async (bagId: string) => bagRepo.removeFromBag(bagId),
    onMutate: async (bagId) => {
      await queryClient.cancelQueries({ queryKey: ['bag', userId] });
      const prev = queryClient.getQueryData<BagClub[]>(['bag', userId]) ?? [];
      queryClient.setQueryData<BagClub[]>(['bag', userId], prev.filter((c) => c.bagId !== bagId));
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(['bag', userId], ctx.prev);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['bag', userId] })
  });

  const renameClub = useMutation({
    mutationFn: async ({ bagId, customName }: { bagId: string; customName: string | null }) =>
      bagRepo.updateBagClub(bagId, { custom_name: customName }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['bag', userId] })
  });

  const reorder = useMutation({
    mutationFn: async (orderedBagIds: string[]) => {
      if (!userId) throw new Error('Not authenticated');
      return bagRepo.reorder(userId, orderedBagIds);
    },
    onMutate: async (ids) => {
      await queryClient.cancelQueries({ queryKey: ['bag', userId] });
      const prev = queryClient.getQueryData<BagClub[]>(['bag', userId]) ?? [];
      const byId = new Map(prev.map((c) => [c.bagId, c]));
      const next = ids
        .map((id, idx) => {
          const c = byId.get(id);
          return c ? { ...c, orderPosition: idx } : null;
        })
        .filter((c): c is BagClub => !!c);
      queryClient.setQueryData<BagClub[]>(['bag', userId], next);
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(['bag', userId], ctx.prev);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['bag', userId] })
  });

  return { ...query, addClub, removeClub, renameClub, editBagClub, reorder, quickAdd, clearBag };
}

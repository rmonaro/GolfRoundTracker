import { supabase } from '@/lib/supabase';
import type { BagClub, Club, ClubCategory } from '@/models';
import { toAppError } from './errors';

export const bagRepo = {
  async listClubs(): Promise<Club[]> {
    const { data, error } = await supabase
      .from('clubs')
      .select('*')
      .order('name', { ascending: true });
    if (error) throw toAppError(error, 'Could not load clubs');
    return data ?? [];
  },

  async listBag(userId: string): Promise<BagClub[]> {
    const { data, error } = await supabase
      .from('user_bag')
      .select(
        'id, user_id, club_id, custom_name, brand, model, loft, typical_distance_yards, order_position, clubs:club_id(id, name, category)'
      )
      .eq('user_id', userId)
      .order('order_position', { ascending: true });
    if (error) throw toAppError(error, 'Could not load your bag');
    return (data ?? []).map((row) => {
      // `clubs` may be returned as an array depending on relationship inference, normalize it.
      const club = Array.isArray(row.clubs) ? row.clubs[0] : row.clubs;
      return {
        bagId: row.id,
        clubId: row.club_id,
        customName: row.custom_name,
        brand: row.brand ?? null,
        model: row.model ?? null,
        loft: row.loft == null ? null : Number(row.loft),
        typicalDistanceYards:
          row.typical_distance_yards == null
            ? null
            : Number(row.typical_distance_yards),
        orderPosition: row.order_position,
        name: club?.name ?? 'Club',
        category: (club?.category ?? 'iron') as ClubCategory
      };
    });
  },

  async createClub(name: string, category: ClubCategory): Promise<Club> {
    const { data, error } = await supabase
      .from('clubs')
      .insert({ name, category })
      .select('*')
      .single();
    if (error) throw toAppError(error, 'Could not create club');
    return data;
  },

  async addToBag(
    userId: string,
    clubId: string,
    orderPosition: number,
    options: {
      customName?: string | null;
      brand?: string | null;
      model?: string | null;
      loft?: number | null;
      typicalDistanceYards?: number | null;
    } = {}
  ): Promise<void> {
    const { error } = await supabase.from('user_bag').insert({
      user_id: userId,
      club_id: clubId,
      order_position: orderPosition,
      custom_name: options.customName ?? null,
      brand: options.brand ?? null,
      model: options.model ?? null,
      loft: options.loft ?? null,
      typical_distance_yards: options.typicalDistanceYards ?? null
    });
    if (error) throw toAppError(error, 'Could not add club to bag');
  },

  async removeFromBag(bagId: string): Promise<void> {
    const { error } = await supabase.from('user_bag').delete().eq('id', bagId);
    if (error) throw toAppError(error, 'Could not remove club');
  },

  async clearBag(userId: string): Promise<void> {
    const { error } = await supabase.from('user_bag').delete().eq('user_id', userId);
    if (error) throw toAppError(error, 'Could not clear bag');
  },

  async updateBagClub(
    bagId: string,
    patch: {
      custom_name?: string | null;
      brand?: string | null;
      model?: string | null;
      loft?: number | null;
      typical_distance_yards?: number | null;
      order_position?: number;
      club_id?: string;
    }
  ): Promise<void> {
    const { error } = await supabase.from('user_bag').update(patch).eq('id', bagId);
    if (error) throw toAppError(error, 'Could not update club');
  },

  async reorder(userId: string, orderedBagIds: string[]): Promise<void> {
    // Optimistic batch reorder: each row gets its new order_position.
    const updates = orderedBagIds.map((bagId, idx) => ({ id: bagId, order_position: idx }));
    const { error } = await supabase
      .from('user_bag')
      .upsert(updates as never, { onConflict: 'id' });
    if (error) throw toAppError(error, 'Could not reorder bag');
    // user_id is unused in update path, but kept to make signature obvious for callers.
    void userId;
  }
};

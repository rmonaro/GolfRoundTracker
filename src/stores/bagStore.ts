import { create } from 'zustand';
import type { BagClub } from '@/models';

interface BagState {
  clubs: BagClub[];
  setClubs: (c: BagClub[]) => void;
}

export const useBagStore = create<BagState>((set) => ({
  clubs: [],
  setClubs: (clubs) => set({ clubs })
}));

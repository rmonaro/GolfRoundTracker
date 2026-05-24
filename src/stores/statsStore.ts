import { create } from 'zustand';
import type { Round } from '@/models';

interface StatsState {
  rounds: Round[];
  setRounds: (r: Round[]) => void;
}

export const useStatsStore = create<StatsState>((set) => ({
  rounds: [],
  setRounds: (rounds) => set({ rounds })
}));

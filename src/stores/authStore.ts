import { create } from 'zustand';
import type { Session } from '@supabase/supabase-js';
import type { Profile } from '@/models';

interface AuthState {
  session: Session | null;
  profile: Profile | null;
  initializing: boolean;
  setSession: (s: Session | null) => void;
  setProfile: (p: Profile | null) => void;
  setInitializing: (v: boolean) => void;
  reset: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  session: null,
  profile: null,
  initializing: true,
  setSession: (session) => set({ session }),
  setProfile: (profile) => set({ profile }),
  setInitializing: (initializing) => set({ initializing }),
  reset: () => set({ session: null, profile: null })
}));

// React binding for the connectivity module. The module itself is framework-free
// so repos/services can read it; this is the component-facing view.

import { useSyncExternalStore } from 'react';
import {
  getConnectivity,
  subscribeConnectivity,
  type ConnectivityStatus
} from '@/services/connectivity';

export function useConnectivity() {
  const state = useSyncExternalStore(subscribeConnectivity, getConnectivity, getConnectivity);
  return {
    ...state,
    /** `degraded` counts as unusable — see the note in connectivity.ts. */
    isOnline: state.status === 'online',
    isOffline: state.status === 'offline'
  };
}

export type { ConnectivityStatus };

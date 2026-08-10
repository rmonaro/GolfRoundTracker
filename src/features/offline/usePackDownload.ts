// React view of the background course-imagery download.
//
// The download itself is kicked off from plain services (`useStartRound`, and
// again whenever the round screen mounts), so the progress lives in
// `coursePackRepo` as a framework-free observable. This is the thin adapter.

import { useSyncExternalStore } from 'react';
import {
  getPackDownload,
  subscribePackDownload,
  type PackDownloadState
} from '@/services/coursePackRepo';

// Server snapshot: there is no download in flight during SSR / prerender, and
// returning a fresh object here would loop.
const serverSnapshot = (): PackDownloadState | null => null;

/**
 * Progress of the in-flight pack download, or null when nothing is downloading.
 * Pass a `courseId` to only report the download for that course — the round
 * screen cares about its own course, not one triggered elsewhere.
 */
export function usePackDownload(courseId?: string | null): PackDownloadState | null {
  const state = useSyncExternalStore(subscribePackDownload, getPackDownload, serverSnapshot);
  if (!state) return null;
  if (courseId && state.courseId !== courseId) return null;
  return state;
}

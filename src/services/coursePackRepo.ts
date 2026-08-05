// Downloaded satellite imagery packs (one PMTiles file per course).
//
// Separate from courseCacheRepo, which holds the ~145 KB of vector geometry.
// These are ~4 MB each — roughly 28x larger — so they're opt-in, listed, and
// deletable, where geometry is just cached silently.
//
// Storage choice: the bytes go in IndexedDB as a Blob rather than the Capacitor
// Filesystem. Reading a whole 4 MB pack into memory is trivial, and it sidesteps
// the open question of whether `capacitor://` file URLs honour HTTP Range —
// which is what a file-backed PMTiles source would depend on. One less thing
// that can silently fail on a course with no signal.

import { get, set, del, keys, createStore } from 'idb-keyval';
import { supabase } from '@/lib/supabase';
import { isUsablyOnline } from './connectivity';
import { toAppError } from './errors';

const store = createStore('grt-course-packs', 'packs');

export interface CoursePackMeta {
  courseId: string;
  courseName: string | null;
  sizeBytes: number;
  minZoom: number | null;
  maxZoom: number | null;
  attribution: string | null;
  downloadedAt: string;
  /**
   * `courses.tiles_generated_at` at the moment this pack was downloaded.
   *
   * Without it a re-tiled course is invisible: the downloaded pack always wins
   * over the remote one, so a golfer who saved maps before the imagery was
   * regenerated keeps seeing the OLD imagery forever, with nothing indicating
   * why. Comparing this against the current value is how staleness is detected.
   */
  generatedAt: string | null;
}

interface StoredPack extends CoursePackMeta {
  bytes: ArrayBuffer;
}

/** What the server knows about a course's pack, before we download it. */
export interface RemotePackInfo {
  tilesUrl: string;
  sizeBytes: number | null;
  minZoom: number | null;
  maxZoom: number | null;
  attribution: string | null;
  capturedAt: string | null;
  generatedAt: string | null;
}

function keyFor(courseId: string) {
  return `pack:${courseId}`;
}

/** Look up whether a course has imagery available to download. */
export async function getRemotePackInfo(courseId: string): Promise<RemotePackInfo | null> {
  const { data, error } = await supabase
    .from('courses')
    .select(
      'tiles_url, tiles_size_bytes, tiles_min_zoom, tiles_max_zoom, imagery_attribution, imagery_captured_at, tiles_generated_at'
    )
    .eq('id', courseId)
    .maybeSingle();
  if (error) throw toAppError(error, 'Could not check for course imagery');
  if (!data?.tiles_url) return null;
  return {
    tilesUrl: data.tiles_url as string,
    sizeBytes: (data.tiles_size_bytes as number | null) ?? null,
    minZoom: (data.tiles_min_zoom as number | null) ?? null,
    maxZoom: (data.tiles_max_zoom as number | null) ?? null,
    attribution: (data.imagery_attribution as string | null) ?? null,
    capturedAt: (data.imagery_captured_at as string | null) ?? null,
    generatedAt: (data.tiles_generated_at as string | null) ?? null
  };
}

/**
 * Download a course's imagery pack to the device.
 *
 * `onProgress` gets 0..1 where the server reports a length. Streamed rather
 * than buffered whole so a slow clubhouse connection shows movement instead of
 * looking hung for a minute.
 */
export async function downloadPack(
  courseId: string,
  courseName: string | null,
  info: RemotePackInfo,
  onProgress?: (fraction: number) => void,
  signal?: AbortSignal
): Promise<CoursePackMeta> {
  const res = await fetch(info.tilesUrl, { signal });
  if (!res.ok) throw new Error(`Imagery download failed (${res.status})`);

  const total = Number(res.headers.get('content-length')) || info.sizeBytes || 0;
  let bytes: ArrayBuffer;

  if (res.body && total > 0) {
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;
      onProgress?.(Math.min(1, received / total));
    }
    const merged = new Uint8Array(received);
    let offset = 0;
    for (const c of chunks) {
      merged.set(c, offset);
      offset += c.length;
    }
    bytes = merged.buffer;
  } else {
    // No content-length (or no streaming support) — fall back to a plain read
    // and report completion only at the end.
    bytes = await res.arrayBuffer();
    onProgress?.(1);
  }

  const meta: CoursePackMeta = {
    courseId,
    courseName,
    sizeBytes: bytes.byteLength,
    minZoom: info.minZoom,
    maxZoom: info.maxZoom,
    attribution: info.attribution,
    downloadedAt: new Date().toISOString(),
    generatedAt: info.generatedAt
  };
  await set(keyFor(courseId), { ...meta, bytes } as StoredPack, store);
  return meta;
}

/** The pack's bytes, or null when this course hasn't been downloaded. */
export async function getPackBytes(courseId: string): Promise<ArrayBuffer | null> {
  try {
    const entry = await get<StoredPack>(keyFor(courseId), store);
    return entry?.bytes ?? null;
  } catch (err) {
    console.warn('[coursePack] read failed', err);
    return null;
  }
}

export async function getPackMeta(courseId: string): Promise<CoursePackMeta | null> {
  try {
    const entry = await get<StoredPack>(keyFor(courseId), store);
    if (!entry) return null;
    // Deliberately drops `bytes` — callers that only need metadata shouldn't
    // hold 4 MB alive.
    const { bytes: _bytes, ...meta } = entry;
    return meta;
  } catch {
    return null;
  }
}

export async function deletePack(courseId: string): Promise<void> {
  await del(keyFor(courseId), store);
}

export async function listPacks(): Promise<CoursePackMeta[]> {
  try {
    const allKeys = await keys(store);
    const entries = await Promise.all(allKeys.map((k) => get<StoredPack>(k as string, store)));
    return entries
      .filter((e): e is StoredPack => !!e)
      .map(({ bytes: _bytes, ...meta }) => meta)
      .sort((a, b) => b.downloadedAt.localeCompare(a.downloadedAt));
  } catch (err) {
    console.warn('[coursePack] list failed', err);
    return [];
  }
}

/**
 * True when the server has regenerated this course's imagery since the pack on
 * this device was downloaded.
 *
 * Treated as fresh when either timestamp is missing — better to keep using a
 * working pack than to nag about a comparison we can't actually make.
 */
export function isPackStale(
  local: CoursePackMeta | null,
  remote: RemotePackInfo | null
): boolean {
  if (!local || !remote?.generatedAt || !local.generatedAt) return false;
  return remote.generatedAt > local.generatedAt;
}

/**
 * Courses whose pack is being fetched right now, so a second trigger (starting
 * a round again, or resuming one) doesn't run a duplicate multi-megabyte
 * download alongside the first.
 */
const inFlight = new Set<string>();

/** True while a background pack download for this course is running. */
export function isPackDownloading(courseId: string): boolean {
  return inFlight.has(courseId);
}

export interface PackDownloadState {
  courseId: string;
  courseName: string | null;
  /** 0..1. Stays at 0 when the server reports no content-length. */
  fraction: number;
  /** Expected total, for showing "12.4 MB" alongside the bar. */
  sizeBytes: number | null;
}

/**
 * Progress of the current background pack download, for UI to display.
 *
 * A module-level value plus listeners rather than a store: this is written from
 * a plain service with no React in scope, and read via `useSyncExternalStore`.
 * The identity only changes when progress actually changes, which is what makes
 * it safe as a `getSnapshot` result.
 */
let downloadState: PackDownloadState | null = null;
const downloadListeners = new Set<() => void>();

export function subscribePackDownload(listener: () => void): () => void {
  downloadListeners.add(listener);
  return () => downloadListeners.delete(listener);
}

export function getPackDownload(): PackDownloadState | null {
  return downloadState;
}

function setDownloadState(next: PackDownloadState | null) {
  downloadState = next;
  for (const l of downloadListeners) l();
}

/**
 * Pull this course's satellite imagery onto the device in the background.
 *
 * Called when a round starts, alongside the geometry cache. Geometry alone
 * (~145 KB) keeps scoring and distances working with no signal, but the MAP
 * falls back to the schematic SVG — and the satellite view is what golfers
 * actually read a hole from. This is what makes losing signal mid-round a
 * non-event rather than a downgrade.
 *
 * Fire-and-forget by design, mirroring `cacheCourseInBackground`: the golfer
 * asked to start a round, not to manage a download, so nothing here may block
 * or fail that. Skips silently when a current pack is already on the device,
 * when the course has no imagery built yet, or when there's no usable signal.
 *
 * NOTE ON DATA: packs currently run ~3–45 MB. This deliberately does NOT wait
 * for Wi-Fi — the whole scenario is a golfer in a car park on cellular, so a
 * Wi-Fi-only rule would skip exactly when it's needed.
 */
export function downloadPackInBackground(
  courseId: string | null | undefined,
  courseName: string | null
): void {
  if (!courseId || inFlight.has(courseId)) return;
  inFlight.add(courseId);
  void (async () => {
    try {
      if (!isUsablyOnline()) return;
      const local = await getPackMeta(courseId);
      const remote = await getRemotePackInfo(courseId).catch(() => null);
      // No imagery tiled for this course yet — nothing to do, and not an error.
      if (!remote) return;
      // Already have it, and the server hasn't re-tiled since.
      if (local && !isPackStale(local, remote)) return;
      setDownloadState({ courseId, courseName, fraction: 0, sizeBytes: remote.sizeBytes });
      await downloadPack(courseId, courseName, remote, (fraction) =>
        setDownloadState({ courseId, courseName, fraction, sizeBytes: remote.sizeBytes })
      );
    } catch (err) {
      console.warn('[coursePack] background download failed', err);
    } finally {
      inFlight.delete(courseId);
      // Clear on success AND on failure — a bar frozen at 60% because the
      // connection dropped is worse than no bar, and the round screen retries
      // on its next mount anyway.
      setDownloadState(null);
    }
  })();
}

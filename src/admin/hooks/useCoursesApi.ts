import { useMutation } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export interface SearchResult {
  courseApiId: string;
  name: string;
  clubName: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  lat: number | null;
  lng: number | null;
  alreadyImported: boolean;
}

/**
 * Turn a functions.invoke failure into something diagnosable.
 *
 * On any non-2xx, supabase-js throws a FunctionsHttpError whose `message` is
 * the useless "Edge Function returned a non-2xx status code" — the body our
 * function actually returned (`{ error: { message, details } }`) is stashed
 * unread on `error.context`, which is the raw Response. Read it, so a failure
 * says what went wrong instead of only that something did.
 */
async function functionErrorMessage(error: unknown, fallback: string): Promise<string> {
  const context = (error as { context?: unknown }).context;
  if (context instanceof Response) {
    try {
      const body = await context.clone().json();
      const inner = (body as { error?: { message?: string; details?: unknown } })?.error;
      if (inner?.message) {
        const details =
          typeof inner.details === 'string' && inner.details ? ` — ${inner.details}` : '';
        return `${inner.message}${details}`;
      }
      if (typeof body === 'string' && body) return body;
    } catch {
      try {
        const text = await context.clone().text();
        if (text) return text.slice(0, 500);
      } catch {
        // Body already consumed or unreadable — fall through to the message.
      }
    }
  }
  const message = (error as { message?: string }).message;
  return message || fallback;
}

async function callCoursesApi<T>(action: string, payload: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('courses-api', {
    body: { action, ...payload }
  });
  if (error) throw new Error(await functionErrorMessage(error, 'Function call failed'));
  if (data && typeof data === 'object' && 'error' in data) {
    const err = (data as { error: { message?: string } }).error;
    throw new Error(err.message ?? 'API error');
  }
  return data as T;
}

export function useSearchCourses() {
  return useMutation({
    mutationFn: (query: string) =>
      callCoursesApi<{ results: SearchResult[] }>('search', { query })
  });
}

export function useBulkImport() {
  return useMutation({
    mutationFn: (courseApiIds: string[]) =>
      callCoursesApi<{ imported: number; failed: Array<{ id: string; error: string }> }>(
        'bulkImport',
        { courseApiIds }
      )
  });
}

/**
 * Single-course import. Used by the Start Round picker so a regular user can
 * grab a course from GolfCourseAPI on demand. Returns the upserted DB row so
 * the caller can auto-select it after import.
 */
export interface ImportedCourse {
  id: string;
  name: string;
  course_api_id: string | null;
  source: string | null;
  [k: string]: unknown;
}

export function useImportCourse() {
  return useMutation({
    mutationFn: (courseApiId: string) =>
      callCoursesApi<{ course: ImportedCourse }>('import', { courseApiId })
  });
}

export interface ResyncArgs {
  courseId: string;
  /**
   * When provided, the edge function skips its Overpass network call and uses
   * this pasted JSON instead. Use case: our edge IPs are blocked by Overpass
   * mirrors but the admin can fetch the same query in their browser via
   * Overpass Turbo and paste the result here.
   */
  overpassJson?: string;
}

export function useResyncCourse() {
  return useMutation({
    mutationFn: async (args: ResyncArgs) => {
      const { data, error } = await supabase.functions.invoke('sync-course-osm', {
        body: {
          courseId: args.courseId,
          ...(args.overpassJson ? { overpassJson: args.overpassJson } : {})
        }
      });
      if (error) throw new Error(await functionErrorMessage(error, 'Function call failed'));
      if (data && typeof data === 'object' && 'error' in data) {
        const err = (data as { error: { message?: string } }).error;
        throw new Error(err.message ?? 'Sync error');
      }
      return data as {
        ok: boolean;
        status: string;
        holes?: number;
        features?: number;
        /** Why the sync ended this way — set on failed / no_coverage. */
        error?: string;
        diagnostics?: SyncDiagnostics;
      };
    }
  });
}

/** Mirrors the SyncDiagnostics interface in the sync-course-osm edge function. */
export interface SyncDiagnostics {
  overpassElements: number;
  golfTagCounts: Record<string, number>;
  golfTaggedWithoutGeometry: number;
  /** Ways listing node ids whose nodes aren't in the payload — a re-export
   *  problem, not a partial response. */
  waysWithUnresolvedNodes?: number;
  holeWaysWithoutRef: number;
  /** Distinct course labels in hole refs. More than one means the extract
   *  covers several courses and needs a ref filter on this course. */
  holeRefLabels?: string[];
  holeRefFilter?: string;
  holesAfterRefFilter?: number;
  overpassRemark?: string;
  mirror?: string;
  attemptedMirrors?: string[];
  attemptDetails?: Array<{
    id: string;
    status: number | 'error';
    bodyChars: number;
    snippet?: string;
    error?: string;
  }>;
}

// ---------------------------------------------------------------------------
// Coordinate backfill from OpenGolfAPI (ODbL — © OpenStreetMap contributors)
// ---------------------------------------------------------------------------

export interface CoordMatch {
  openGolfId: string;
  name: string;
  city: string | null;
  state: string | null;
  lat: number;
  lng: number;
}

export interface CoordProposal {
  courseId: string;
  courseName: string;
  clubName: string | null;
  city: string | null;
  state: string | null;
  confidence: 'exact' | 'likely' | 'weak';
  score: number;
  match: CoordMatch | null;
}

export function useBackfillCoordsPreview() {
  return useMutation({
    mutationFn: (limit = 25) =>
      callCoursesApi<{ proposals: CoordProposal[]; attribution: string; scanned: number }>(
        'backfillCoordsPreview',
        { limit }
      )
  });
}

export function useBackfillCoordsApply() {
  return useMutation({
    mutationFn: (updates: Array<{ courseId: string; lat: number; lng: number }>) =>
      callCoursesApi<{ updated: number; failed: Array<{ courseId: string; error: string }> }>(
        'backfillCoordsApply',
        { updates }
      )
  });
}

// ---------------------------------------------------------------------------
// Scorecard import from OpenGolfAPI (ODbL — © OpenStreetMap contributors)
// ---------------------------------------------------------------------------

export interface ScorecardHolePreview {
  holeNumber: number;
  par: { current: number | null; incoming: number | null };
  handicap: { current: number | null; incoming: number | null };
  changed: boolean;
}

export interface ScorecardTeePreview {
  teeName: string | null;
  teeColor: string | null;
  gender: 'male' | 'female' | null;
  courseRating: number | null;
  slope: number | null;
  par: number | null;
  yardage: number | null;
}

export interface ScorecardPreview {
  openGolfId: string | null;
  matchName: string | null;
  confidence: 'exact' | 'likely' | 'weak';
  holes: ScorecardHolePreview[];
  tees: ScorecardTeePreview[];
  attribution: string;
}

export function useScorecardPreview() {
  return useMutation({
    mutationFn: (courseId: string) =>
      callCoursesApi<ScorecardPreview>('scorecardPreview', { courseId })
  });
}

export function useScorecardApply() {
  return useMutation({
    mutationFn: (args: { courseId: string; openGolfId: string }) =>
      callCoursesApi<{ holesUpdated: number; teesUpserted: number; attribution: string }>(
        'scorecardApply',
        args
      )
  });
}

// ---------------------------------------------------------------------------
// Bulk state import from OpenGolfAPI (ODbL — © OpenStreetMap contributors)
// ---------------------------------------------------------------------------

export interface StateImportResult {
  state: string;
  /** Courses OpenGolfAPI holds for this state. */
  total: number;
  /** Courses in this page. */
  scanned: number;
  /** New rows created. */
  imported: number;
  /** Existing courses matched and given an opengolf_id. */
  linked: number;
  /** Already linked on a previous run. */
  skipped: number;
  /** Each link made this page, so a wrong match can be spotted and undone. */
  links: Array<{
    courseId: string;
    localName: string;
    matchName: string;
    score: number;
    km: number | null;
  }>;
  /** Offset for the next page, or null when the state is exhausted. */
  nextOffset: number | null;
  attribution: string;
}

export function useStateImport() {
  return useMutation({
    mutationFn: (args: { state: string; offset?: number; limit?: number }) =>
      callCoursesApi<StateImportResult>('stateImport', args)
  });
}

export interface OsmBatchResult {
  processed: number;
  /** Courses still pending after this batch — drives the progress loop. */
  remaining: number;
  /** The batch hit its time budget and returned early. Means "ask again",
   *  not "something failed" — Overpass was slow, the queue is untouched. */
  timedOut?: boolean;
  results: Array<{ courseId: string; status: string; error?: string }>;
}

/** One batch of the pending-OSM queue. Each course costs an Overpass round
 *  trip, so the admin page loops small batches rather than asking for 100. */
export function useOsmSyncBatch() {
  return useMutation({
    mutationFn: async (limit: number) => {
      const { data, error } = await supabase.functions.invoke('sync-course-osm', {
        body: { limit }
      });
      if (error) throw new Error(await functionErrorMessage(error, 'Function call failed'));
      if (data && typeof data === 'object' && 'error' in data) {
        const err = (data as { error: { message?: string } }).error;
        throw new Error(err.message ?? 'Sync error');
      }
      return data as OsmBatchResult;
    }
  });
}

// ---------------------------------------------------------------------------
// Manual hole layout — clicked tee/green pairs for courses OSM never mapped
// ---------------------------------------------------------------------------

export interface ManualLayoutArgs {
  courseId: string;
  holes: Array<{ number: number; tee: [number, number]; green: [number, number]; par: number | null }>;
  features: Array<{ featureType: string; coords: [number, number][] }>;
}

export function useManualLayout() {
  return useMutation({
    mutationFn: (args: ManualLayoutArgs) =>
      callCoursesApi<{ holes: number; features: number }>('manualLayout', args)
  });
}

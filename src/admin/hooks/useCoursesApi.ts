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

async function callCoursesApi<T>(action: string, payload: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('courses-api', {
    body: { action, ...payload }
  });
  if (error) throw new Error(error.message ?? 'Function call failed');
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
      if (error) throw new Error(error.message ?? 'Function call failed');
      if (data && typeof data === 'object' && 'error' in data) {
        const err = (data as { error: { message?: string } }).error;
        throw new Error(err.message ?? 'Sync error');
      }
      return data as {
        ok: boolean;
        status: string;
        holes?: number;
        features?: number;
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
  holeWaysWithoutRef: number;
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

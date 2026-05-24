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

export function useResyncCourse() {
  return useMutation({
    mutationFn: async (courseId: string) => {
      const { data, error } = await supabase.functions.invoke('sync-course-osm', {
        body: { courseId }
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
      };
    }
  });
}

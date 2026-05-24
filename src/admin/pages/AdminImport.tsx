import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  CircularProgress,
  Stack,
  TextField,
  Typography
} from '@mui/material';
import { useQueryClient } from '@tanstack/react-query';
import { useBulkImport, useSearchCourses } from '../hooks/useCoursesApi';

export function AdminImport() {
  const queryClient = useQueryClient();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const search = useSearchCourses();
  const bulkImport = useBulkImport();

  const onSearch = () => {
    if (!query.trim()) return;
    setSelected(new Set());
    search.mutate(query.trim());
  };

  const toggle = (id: string, alreadyImported: boolean) => {
    if (alreadyImported) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const onImport = () => {
    bulkImport.mutate([...selected], {
      onSuccess: () => {
        setSelected(new Set());
        if (query.trim()) search.mutate(query.trim());
        queryClient.invalidateQueries({ queryKey: ['admin-all-courses'] });
        queryClient.invalidateQueries({ queryKey: ['admin-stats'] });
        queryClient.invalidateQueries({ queryKey: ['courses'] });
      }
    });
  };

  return (
    <Box sx={{ p: 2, pb: 14 }}>
      <Stack direction="row" spacing={1}>
        <TextField
          fullWidth
          label="Search GolfCourseAPI"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && onSearch()}
        />
        <Button
          variant="contained"
          onClick={onSearch}
          disabled={search.isPending || !query.trim()}
          sx={{ minHeight: 56 }}
        >
          Search
        </Button>
      </Stack>

      {search.error && (
        <Alert severity="error" sx={{ mt: 2 }}>
          {(search.error as Error).message}
        </Alert>
      )}
      {bulkImport.error && (
        <Alert severity="error" sx={{ mt: 2 }}>
          {(bulkImport.error as Error).message}
        </Alert>
      )}
      {bulkImport.data && (
        <Alert severity={bulkImport.data.failed.length > 0 ? 'warning' : 'success'} sx={{ mt: 2 }}>
          Imported {bulkImport.data.imported}.
          {bulkImport.data.failed.length > 0 && ` ${bulkImport.data.failed.length} failed.`}
        </Alert>
      )}

      {search.isPending && (
        <Box sx={{ display: 'grid', placeItems: 'center', py: 4 }}>
          <CircularProgress />
        </Box>
      )}

      {search.data && (
        <Stack spacing={1} mt={2}>
          {search.data.results.length === 0 && (
            <Typography variant="body2" color="text.secondary">No results.</Typography>
          )}
          {search.data.results.map((r) => (
            <Card key={r.courseApiId} elevation={0} sx={{ bgcolor: 'background.paper' }}>
              <CardContent
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1,
                  py: 1.5,
                  '&:last-child': { pb: 1.5 }
                }}
              >
                <Checkbox
                  checked={selected.has(r.courseApiId)}
                  disabled={r.alreadyImported}
                  onChange={() => toggle(r.courseApiId, r.alreadyImported)}
                />
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="subtitle2" noWrap>
                    {r.name}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" noWrap>
                    {[r.clubName, r.city, r.state, r.country].filter(Boolean).join(' · ') || '—'}
                  </Typography>
                </Box>
                {r.alreadyImported && (
                  <Typography variant="caption" color="primary" sx={{ fontWeight: 600 }}>
                    Already imported
                  </Typography>
                )}
              </CardContent>
            </Card>
          ))}
        </Stack>
      )}

      {selected.size > 0 && (
        <Box
          sx={{
            position: 'fixed',
            bottom: 0,
            left: 0,
            right: 0,
            p: 2,
            pb: 'calc(env(safe-area-inset-bottom) + 12px)',
            bgcolor: 'background.paper',
            borderTop: 1,
            borderColor: 'divider',
            zIndex: 6
          }}
        >
          <Button
            variant="contained"
            fullWidth
            size="large"
            onClick={onImport}
            disabled={bulkImport.isPending}
            sx={{ minHeight: 56, fontSize: '1.05rem', fontWeight: 700 }}
          >
            {bulkImport.isPending
              ? 'Importing…'
              : `Import ${selected.size} course${selected.size === 1 ? '' : 's'}`}
          </Button>
        </Box>
      )}
    </Box>
  );
}

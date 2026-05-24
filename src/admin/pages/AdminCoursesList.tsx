import {
  Box,
  Chip,
  CircularProgress,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography
} from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { adminCoursesRepo } from '@/services/adminCoursesRepo';

const STATUS_COLOR: Record<string, 'default' | 'success' | 'warning' | 'error' | 'info'> = {
  synced: 'success',
  pending: 'info',
  failed: 'error',
  no_coverage: 'warning',
  skip: 'default'
};

export function AdminCoursesList() {
  const navigate = useNavigate();
  const { data: courses, isLoading } = useQuery({
    queryKey: ['admin-all-courses'],
    queryFn: () => adminCoursesRepo.listAll()
  });

  if (isLoading) {
    return (
      <Box sx={{ display: 'grid', placeItems: 'center', py: 6 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box sx={{ p: 2, overflowX: 'auto' }}>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
        {courses?.length ?? 0} courses · tap a row for detail
      </Typography>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Name</TableCell>
            <TableCell>Club</TableCell>
            <TableCell>Location</TableCell>
            <TableCell>Source</TableCell>
            <TableCell>OSM</TableCell>
            <TableCell>Synced</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {courses?.map((c) => (
            <TableRow
              key={c.id}
              hover
              onClick={() => navigate(`/admin/courses/${c.id}`)}
              sx={{ cursor: 'pointer' }}
            >
              <TableCell sx={{ fontWeight: 600 }}>{c.name}</TableCell>
              <TableCell>{c.club_name ?? '—'}</TableCell>
              <TableCell>
                <Stack direction="row" spacing={0.5}>
                  {[c.city, c.state].filter(Boolean).join(', ') || '—'}
                </Stack>
              </TableCell>
              <TableCell>
                <Chip size="small" label={c.source ?? '—'} />
              </TableCell>
              <TableCell>
                <Chip
                  size="small"
                  label={c.osm_status ?? '—'}
                  color={STATUS_COLOR[c.osm_status ?? ''] ?? 'default'}
                />
              </TableCell>
              <TableCell sx={{ whiteSpace: 'nowrap' }}>
                {c.osm_synced_at ? new Date(c.osm_synced_at).toLocaleDateString() : '—'}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Box>
  );
}

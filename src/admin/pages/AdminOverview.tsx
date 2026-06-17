import { Box, Card, CardActionArea, CardContent, Chip, CircularProgress, Stack, Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { adminCoursesRepo } from '@/services/adminCoursesRepo';
import { supabase } from '@/lib/supabase';

async function countTable(table: 'profiles' | 'rounds'): Promise<number> {
  const { count } = await supabase.from(table).select('*', { count: 'exact', head: true });
  return count ?? 0;
}

const STATUS_COLOR: Record<string, 'default' | 'success' | 'warning' | 'error' | 'info'> = {
  synced: 'success',
  pending: 'info',
  failed: 'error',
  no_coverage: 'warning',
  skip: 'default'
};

export function AdminOverview() {
  const navigate = useNavigate();
  const { data, isLoading } = useQuery({
    queryKey: ['admin-stats'],
    queryFn: () => adminCoursesRepo.stats(),
    staleTime: 30 * 1000
  });
  const { data: userCount } = useQuery({
    queryKey: ['admin-user-count'],
    queryFn: () => countTable('profiles'),
    staleTime: 30 * 1000
  });
  const { data: roundCount } = useQuery({
    queryKey: ['admin-round-count'],
    queryFn: () => countTable('rounds'),
    staleTime: 30 * 1000
  });

  if (isLoading || !data) {
    return (
      <Box sx={{ display: 'grid', placeItems: 'center', py: 6 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box sx={{ p: 2 }}>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={2}
        useFlexGap
        flexWrap="wrap"
      >
        <Card elevation={0} sx={{ bgcolor: 'background.paper', flex: 1, minWidth: 240 }}>
          <CardActionArea onClick={() => navigate('/admin/users')}>
            <CardContent>
              <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 0.6 }}>
                Users
              </Typography>
              <Typography variant="h3" sx={{ fontWeight: 800 }}>
                {userCount ?? '—'}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                registered
              </Typography>
            </CardContent>
          </CardActionArea>
        </Card>
        <Card elevation={0} sx={{ bgcolor: 'background.paper', flex: 1, minWidth: 240 }}>
          <CardActionArea onClick={() => navigate('/admin/rounds')}>
            <CardContent>
              <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 0.6 }}>
                Rounds Played
              </Typography>
              <Typography variant="h3" sx={{ fontWeight: 800 }}>
                {roundCount ?? '—'}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                across all users
              </Typography>
            </CardContent>
          </CardActionArea>
        </Card>
        <Card elevation={0} sx={{ bgcolor: 'background.paper', flex: 1, minWidth: 240 }}>
          <CardActionArea onClick={() => navigate('/admin/courses')}>
            <CardContent>
              <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 0.6 }}>
                Course Library
              </Typography>
              <Typography variant="h3" sx={{ fontWeight: 800 }}>
                {data.apiCount}
              </Typography>
              <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap mt={1}>
                {Object.entries(data.byStatus).map(([k, v]) => (
                  <Chip key={k} size="small" label={`${k}: ${v}`} color={STATUS_COLOR[k] ?? 'default'} />
                ))}
              </Stack>
            </CardContent>
          </CardActionArea>
        </Card>
        <Card elevation={0} sx={{ bgcolor: 'background.paper', flex: 1, minWidth: 240 }}>
          <CardContent>
            <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 0.6 }}>
              Sync Queue
            </Typography>
            <Typography variant="h3" sx={{ fontWeight: 800 }}>
              {data.pendingSync}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              pending + failed
            </Typography>
          </CardContent>
        </Card>
        <Card elevation={0} sx={{ bgcolor: 'background.paper', flex: 1, minWidth: 240 }}>
          <CardActionArea onClick={() => navigate('/admin/review')}>
            <CardContent>
              <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 0.6 }}>
                Orientation Review
              </Typography>
              <Typography variant="h3" sx={{ fontWeight: 800 }}>
                {data.lowConfidenceHoles}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                assumed + reversed
              </Typography>
            </CardContent>
          </CardActionArea>
        </Card>
      </Stack>
    </Box>
  );
}

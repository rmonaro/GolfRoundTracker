import { Box, CircularProgress, Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { adminRoundsRepo } from '@/services/adminRoundsRepo';
import { RoundsTable } from '../components/RoundsTable';

export function AdminRounds() {
  const navigate = useNavigate();
  const { data: rounds, isLoading } = useQuery({
    queryKey: ['admin-rounds'],
    queryFn: () => adminRoundsRepo.listAll()
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
        {rounds?.length ?? 0} rounds · click a row for hole-by-hole detail
      </Typography>
      <RoundsTable
        rounds={rounds ?? []}
        showPlayer
        onRowClick={(r) => navigate(`/admin/rounds/${r.id}`)}
      />
    </Box>
  );
}

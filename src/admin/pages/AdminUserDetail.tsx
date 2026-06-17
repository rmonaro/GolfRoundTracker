import {
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  Stack,
  Typography
} from '@mui/material';
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { adminUsersRepo } from '@/services/adminUsersRepo';
import { RoundsTable } from '../components/RoundsTable';

function displayName(first: string | null, last: string | null, email: string): string {
  const name = [first, last].filter(Boolean).join(' ').trim();
  return name || email;
}

export function AdminUserDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const userQuery = useQuery({
    queryKey: ['admin-user', id],
    queryFn: () => adminUsersRepo.getOne(id!),
    enabled: !!id
  });
  const roundsQuery = useQuery({
    queryKey: ['admin-user-rounds', id],
    queryFn: () => adminUsersRepo.listRounds(id!),
    enabled: !!id
  });

  if (userQuery.isLoading) {
    return (
      <Box sx={{ display: 'grid', placeItems: 'center', py: 6 }}>
        <CircularProgress />
      </Box>
    );
  }

  const user = userQuery.data;
  if (!user) {
    return (
      <Box sx={{ p: 2 }}>
        <Button startIcon={<ArrowBackRoundedIcon />} onClick={() => navigate('/admin/users')}>
          Back to users
        </Button>
        <Typography sx={{ mt: 2 }}>User not found.</Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 2 }}>
      <Button
        startIcon={<ArrowBackRoundedIcon />}
        onClick={() => navigate('/admin/users')}
        sx={{ mb: 1 }}
      >
        Back to users
      </Button>

      <Stack direction="row" alignItems="center" spacing={1.5} flexWrap="wrap" useFlexGap>
        <Typography variant="h5" sx={{ fontWeight: 700 }}>
          {displayName(user.first_name, user.last_name, user.email)}
        </Typography>
        {user.is_admin && <Chip size="small" color="primary" label="Admin" />}
      </Stack>
      <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap sx={{ mt: 0.5 }}>
        <Typography variant="body2" color="text.secondary">
          {user.email}
        </Typography>
        {user.skill_level && (
          <Typography variant="body2" color="text.secondary">
            Skill: {user.skill_level}
          </Typography>
        )}
        {user.handicap_goal != null && (
          <Typography variant="body2" color="text.secondary">
            Handicap goal: {user.handicap_goal}
          </Typography>
        )}
        <Typography variant="body2" color="text.secondary">
          Joined {user.created_at ? new Date(user.created_at).toLocaleDateString() : '—'}
        </Typography>
      </Stack>

      <Divider sx={{ my: 2 }} />

      <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1 }}>
        Rounds played {roundsQuery.data ? `(${roundsQuery.data.length})` : ''}
      </Typography>
      {roundsQuery.isLoading ? (
        <Box sx={{ display: 'grid', placeItems: 'center', py: 4 }}>
          <CircularProgress />
        </Box>
      ) : (
        <Box sx={{ overflowX: 'auto' }}>
          <RoundsTable
            rounds={roundsQuery.data ?? []}
            onRowClick={(r) => navigate(`/admin/rounds/${r.id}`)}
          />
        </Box>
      )}
    </Box>
  );
}

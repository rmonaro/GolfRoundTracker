import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Divider,
  Stack,
  Typography
} from '@mui/material';
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { adminUsersRepo } from '@/services/adminUsersRepo';
import { useAuthStore } from '@/stores/authStore';
import { RoundsTable } from '../components/RoundsTable';
import { useIsSuperAdmin } from '../hooks/useIsAdmin';

function displayName(first: string | null, last: string | null, email: string): string {
  const name = [first, last].filter(Boolean).join(' ').trim();
  return name || email;
}

export function AdminUserDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: isSuperAdmin } = useIsSuperAdmin();
  const currentUserId = useAuthStore((s) => s.session?.user.id);
  const [roleError, setRoleError] = useState<string | null>(null);

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

  const setAdmin = useMutation({
    mutationFn: (makeAdmin: boolean) => adminUsersRepo.setUserAdmin(id!, makeAdmin),
    onSuccess: () => {
      setRoleError(null);
      queryClient.invalidateQueries({ queryKey: ['admin-user', id] });
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
    },
    // The RPC refuses self-changes and refuses to touch another super admin;
    // surface its message rather than a generic failure.
    onError: (err) => setRoleError((err as Error).message)
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
        <Typography variant="h5" sx={{ fontWeight: 900, fontSize: '32px' }}>
          {displayName(user.first_name, user.last_name, user.email)}
        </Typography>
        {user.is_super_admin ? (
          <Chip size="small" color="secondary" label="Super admin" />
        ) : (
          user.is_admin && <Chip size="small" color="primary" label="Admin" />
        )}
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

      {/* Admin access — super admins only.
          Hidden entirely rather than shown disabled: an admin has no path to
          this and no reason to wonder why the button won't work. The database
          refuses it either way (migration 042), so this is presentation. */}
      {isSuperAdmin && (
        <Card variant="outlined" sx={{ mt: 2, maxWidth: 520 }}>
          <CardContent>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ textTransform: 'uppercase', letterSpacing: 0.6 }}
            >
              Admin access
            </Typography>

            {roleError && (
              <Alert severity="error" sx={{ mt: 1 }} onClose={() => setRoleError(null)}>
                {roleError}
              </Alert>
            )}

            {user.is_super_admin ? (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                This user is a super admin. Their access can only be changed directly in the
                database — a super admin cannot promote or demote another.
              </Typography>
            ) : user.id === currentUserId ? (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                This is you. You cannot change your own admin access.
              </Typography>
            ) : (
              <Stack spacing={1} sx={{ mt: 1 }} alignItems="flex-start">
                <Typography variant="body2" color="text.secondary">
                  {user.is_admin
                    ? 'Has full access to the admin panel, except granting admin to others.'
                    : 'A normal user. Granting admin gives them the whole panel: courses, rounds and every user.'}
                </Typography>
                <Button
                  size="small"
                  variant={user.is_admin ? 'outlined' : 'contained'}
                  color={user.is_admin ? 'error' : 'primary'}
                  disabled={setAdmin.isPending}
                  onClick={() => setAdmin.mutate(!user.is_admin)}
                >
                  {setAdmin.isPending
                    ? 'Saving…'
                    : user.is_admin
                      ? 'Remove admin'
                      : 'Make admin'}
                </Button>
              </Stack>
            )}
          </CardContent>
        </Card>
      )}

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

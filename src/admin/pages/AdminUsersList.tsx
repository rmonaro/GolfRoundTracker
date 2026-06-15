import {
  Box,
  Chip,
  CircularProgress,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography
} from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { adminUsersRepo } from '@/services/adminUsersRepo';

function displayName(first: string | null, last: string | null, email: string): string {
  const name = [first, last].filter(Boolean).join(' ').trim();
  return name || email;
}

export function AdminUsersList() {
  const navigate = useNavigate();
  const { data: users, isLoading } = useQuery({
    queryKey: ['admin-users'],
    queryFn: () => adminUsersRepo.listAll()
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
        {users?.length ?? 0} users · click a row to view their rounds
      </Typography>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Name</TableCell>
            <TableCell>Email</TableCell>
            <TableCell align="right">Rounds</TableCell>
            <TableCell>Last round</TableCell>
            <TableCell>Joined</TableCell>
            <TableCell>Role</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {users?.map((u) => (
            <TableRow
              key={u.id}
              hover
              onClick={() => navigate(`/admin/users/${u.id}`)}
              sx={{ cursor: 'pointer' }}
            >
              <TableCell sx={{ fontWeight: 600 }}>
                {displayName(u.first_name, u.last_name, u.email)}
              </TableCell>
              <TableCell>{u.email}</TableCell>
              <TableCell align="right">{u.rounds_count}</TableCell>
              <TableCell sx={{ whiteSpace: 'nowrap' }}>
                {u.last_round_at ? new Date(u.last_round_at).toLocaleDateString() : '—'}
              </TableCell>
              <TableCell sx={{ whiteSpace: 'nowrap' }}>
                {u.created_at ? new Date(u.created_at).toLocaleDateString() : '—'}
              </TableCell>
              <TableCell>
                {u.is_admin ? <Chip size="small" color="primary" label="Admin" /> : '—'}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Box>
  );
}

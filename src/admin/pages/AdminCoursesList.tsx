import { useEffect, useState } from 'react';
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography
} from '@mui/material';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { adminCoursesRepo, NO_STATE } from '@/services/adminCoursesRepo';
import { BackfillCoordsDialog } from '@/admin/components/BackfillCoordsDialog';

const STATUS_COLOR: Record<string, 'default' | 'success' | 'warning' | 'error' | 'info'> = {
  synced: 'success',
  pending: 'info',
  failed: 'error',
  no_coverage: 'warning',
  skip: 'default'
};

const US_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DC','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA',
  'ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR',
  'PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY'
];

type CoordsFilter = 'all' | 'missing' | 'present';

/** courses.osm_status values, in the order they read as a pipeline:
 *  waiting -> mapped -> couldn't reach Overpass -> OSM has nothing -> skipped. */
const OSM_STATUSES = ['pending', 'synced', 'failed', 'no_coverage', 'skip'] as const;

const PAGE_SIZE = 100;

/** A course is only syncable/mappable when it has a real lat AND lng. */
const hasCoords = (c: { lat: number | null; lng: number | null }) =>
  typeof c.lat === 'number' && typeof c.lng === 'number';

export function AdminCoursesList() {
  const navigate = useNavigate();
  const [stateFilter, setStateFilter] = useState('all');
  const [coordsFilter, setCoordsFilter] = useState<CoordsFilter>('all');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [osmFilter, setOsmFilter] = useState('all');
  const [verifiedFilter, setVerifiedFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(0);
  const [backfillOpen, setBackfillOpen] = useState(false);

  // Typing shouldn't fire a query per keystroke against a table this size.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  // Any filter change invalidates the current page number.
  useEffect(() => {
    setPage(0);
  }, [stateFilter, coordsFilter, sourceFilter, osmFilter, verifiedFilter, debouncedSearch]);

  const { data, isLoading, isFetching } = useQuery({
    queryKey: [
      'admin-all-courses',
      stateFilter,
      coordsFilter,
      sourceFilter,
      osmFilter,
      verifiedFilter,
      debouncedSearch,
      page
    ],
    queryFn: () =>
      adminCoursesRepo.list({
        state: stateFilter,
        coords: coordsFilter,
        source: sourceFilter,
        osmStatus: osmFilter,
        verified: verifiedFilter,
        search: debouncedSearch,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE
      }),
    placeholderData: keepPreviousData
  });

  const { data: missingCoords } = useQuery({
    queryKey: ['courses-missing-coords'],
    queryFn: () => adminCoursesRepo.missingCoordsCount()
  });

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const from = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const to = Math.min((page + 1) * PAGE_SIZE, total);

  if (isLoading) {
    return (
      <Box sx={{ display: 'grid', placeItems: 'center', py: 6 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box sx={{ p: 2, overflowX: 'auto' }}>
      {/* One row, deliberately: the three filters read as a set, and wrapping
          split them across lines once the sidebar took its width. Search flexes
          to absorb the slack so the selects keep fixed, equal-ish widths. */}
      <Stack
        direction="row"
        alignItems="center"
        spacing={1.5}
        sx={{ mb: 1, flexWrap: 'nowrap' }}
      >
        <TextField
          size="small"
          label="Search"
          placeholder="name, club or city"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          sx={{ flex: 1, minWidth: 140 }}
        />
        <TextField
          select
          size="small"
          label="State"
          value={stateFilter}
          onChange={(e) => setStateFilter(e.target.value)}
          sx={{ width: 110, flexShrink: 0 }}
        >
          <MenuItem value="all">All states</MenuItem>
          {US_STATES.map((s) => (
            <MenuItem key={s} value={s}>
              {s}
            </MenuItem>
          ))}
          <MenuItem value={NO_STATE}>No state</MenuItem>
        </TextField>
        <TextField
          select
          size="small"
          label="Coords"
          value={coordsFilter}
          onChange={(e) => setCoordsFilter(e.target.value as CoordsFilter)}
          sx={{ width: 155, flexShrink: 0 }}
        >
          <MenuItem value="all">Any coords</MenuItem>
          <MenuItem value="missing">
            Missing coords{missingCoords != null ? ` (${missingCoords})` : ''}
          </MenuItem>
          <MenuItem value="present">Has coords</MenuItem>
        </TextField>
        <TextField
          select
          size="small"
          label="Source"
          value={sourceFilter}
          onChange={(e) => setSourceFilter(e.target.value)}
          sx={{ width: 140, flexShrink: 0 }}
        >
          <MenuItem value="all">All sources</MenuItem>
          <MenuItem value="api">GolfCourseAPI</MenuItem>
          <MenuItem value="opengolf">OpenGolfAPI</MenuItem>
          <MenuItem value="user">User-added</MenuItem>
        </TextField>
        <TextField
          select
          size="small"
          label="OSM"
          value={osmFilter}
          onChange={(e) => setOsmFilter(e.target.value)}
          sx={{ width: 145, flexShrink: 0 }}
        >
          <MenuItem value="all">Any status</MenuItem>
          {OSM_STATUSES.map((st) => (
            <MenuItem key={st} value={st}>
              {st}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          select
          size="small"
          label="Verified"
          value={verifiedFilter}
          onChange={(e) => setVerifiedFilter(e.target.value)}
          sx={{ width: 130, flexShrink: 0 }}
        >
          <MenuItem value="all">Any</MenuItem>
          <MenuItem value="yes">Verified</MenuItem>
          <MenuItem value="no">Unverified</MenuItem>
        </TextField>
      </Stack>

      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
        <Typography variant="caption" color="text.secondary">
          {total === 0 ? 'No matches' : `${from}–${to} of ${total.toLocaleString()}`} · tap a row for
          detail
        </Typography>
        {isFetching && <CircularProgress size={12} />}
        <Box sx={{ flex: 1 }} />
        {!!missingCoords && (
          <Button
            size="small"
            variant="outlined"
            onClick={() => setBackfillOpen(true)}
            sx={{ flexShrink: 0, whiteSpace: 'nowrap', mr: 1 }}
          >
            Backfill coords
          </Button>
        )}
        <Button size="small" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
          Prev
        </Button>
        <Button size="small" disabled={to >= total} onClick={() => setPage((p) => p + 1)}>
          Next
        </Button>
      </Stack>

      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Name</TableCell>
            <TableCell>Club</TableCell>
            <TableCell>Location</TableCell>
            <TableCell>Coords</TableCell>
            <TableCell>Source</TableCell>
            <TableCell>OSM</TableCell>
            <TableCell>Synced</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((c) => (
            <TableRow
              key={c.id}
              hover
              onClick={() => navigate(`/admin/courses/${c.id}`)}
              sx={{ cursor: 'pointer' }}
            >
              <TableCell sx={{ fontWeight: 600 }}>{c.name}</TableCell>
              <TableCell>{c.club_name ?? '—'}</TableCell>
              <TableCell>{[c.city, c.state].filter(Boolean).join(', ') || '—'}</TableCell>
              <TableCell sx={{ whiteSpace: 'nowrap' }}>
                {hasCoords(c) ? (
                  <Typography variant="caption" color="text.secondary">
                    {c.lat!.toFixed(4)}, {c.lng!.toFixed(4)}
                  </Typography>
                ) : (
                  <Chip size="small" label="missing" color="warning" />
                )}
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
          {rows.length === 0 && (
            <TableRow>
              <TableCell colSpan={7}>
                <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
                  No courses match these filters.
                </Typography>
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      <BackfillCoordsDialog open={backfillOpen} onClose={() => setBackfillOpen(false)} />
    </Box>
  );
}

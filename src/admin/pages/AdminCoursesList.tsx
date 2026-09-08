import { useEffect, useState } from 'react';
import {
  Badge,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  Drawer,
  IconButton,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography
} from '@mui/material';
import FilterListRoundedIcon from '@mui/icons-material/FilterListRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
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

/**
 * The value each filter holds when it is doing nothing.
 *
 * Written down once because three things depend on agreeing about it: the
 * initial state, the badge that counts active filters, and Clear all. When
 * those drift the badge lies, which is worse than no badge — the whole point of
 * moving the controls out of sight is that the icon has to say whether anything
 * is being hidden from you.
 */
const FILTER_DEFAULTS = {
  state: 'all',
  coords: 'all' as CoordsFilter,
  source: 'all',
  osm: 'all',
  verified: 'all',
  merged: 'active'
};

/** A course is only syncable/mappable when it has a real lat AND lng. */
const hasCoords = (c: { lat: number | null; lng: number | null }) =>
  typeof c.lat === 'number' && typeof c.lng === 'number';

export function AdminCoursesList() {
  const navigate = useNavigate();
  const [stateFilter, setStateFilter] = useState(FILTER_DEFAULTS.state);
  const [coordsFilter, setCoordsFilter] = useState<CoordsFilter>(FILTER_DEFAULTS.coords);
  const [sourceFilter, setSourceFilter] = useState(FILTER_DEFAULTS.source);
  const [osmFilter, setOsmFilter] = useState(FILTER_DEFAULTS.osm);
  const [verifiedFilter, setVerifiedFilter] = useState(FILTER_DEFAULTS.verified);
  // Retired duplicates are hidden by default, so this list matches what
  // players actually see. See migration 040.
  const [mergedFilter, setMergedFilter] = useState(FILTER_DEFAULTS.merged);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(0);
  const [backfillOpen, setBackfillOpen] = useState(false);

  // Search stays out of this: it has its own visible box, so counting it would
  // make the badge claim a hidden filter that isn't hidden.
  const activeFilterCount = [
    stateFilter !== FILTER_DEFAULTS.state,
    coordsFilter !== FILTER_DEFAULTS.coords,
    sourceFilter !== FILTER_DEFAULTS.source,
    osmFilter !== FILTER_DEFAULTS.osm,
    verifiedFilter !== FILTER_DEFAULTS.verified,
    mergedFilter !== FILTER_DEFAULTS.merged
  ].filter(Boolean).length;

  const clearFilters = () => {
    setStateFilter(FILTER_DEFAULTS.state);
    setCoordsFilter(FILTER_DEFAULTS.coords);
    setSourceFilter(FILTER_DEFAULTS.source);
    setOsmFilter(FILTER_DEFAULTS.osm);
    setVerifiedFilter(FILTER_DEFAULTS.verified);
    setMergedFilter(FILTER_DEFAULTS.merged);
  };

  // Typing shouldn't fire a query per keystroke against a table this size.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  // Any filter change invalidates the current page number.
  useEffect(() => {
    setPage(0);
  }, [
    stateFilter,
    coordsFilter,
    sourceFilter,
    osmFilter,
    verifiedFilter,
    mergedFilter,
    debouncedSearch
  ]);

  const { data, isLoading, isFetching } = useQuery({
    queryKey: [
      'admin-all-courses',
      stateFilter,
      coordsFilter,
      sourceFilter,
      osmFilter,
      verifiedFilter,
      mergedFilter,
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
        merged: mergedFilter,
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
      {/* Search stays on the page; everything else lives in the drawer.
          Six selects in a row had eaten most of the width next to a sidebar,
          and they were nearly always all set to "all" — a lot of permanent
          furniture for something used occasionally. The badge is what makes
          this safe: filters you can't see must still announce themselves, or
          you spend a while wondering why a course is missing. */}
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
        <TextField
          size="small"
          label="Search"
          placeholder="name, club or city"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          sx={{ flex: 1, maxWidth: 420 }}
        />
        <Tooltip title={activeFilterCount ? `${activeFilterCount} filter(s) applied` : 'Filters'}>
          <IconButton
            onClick={() => setFiltersOpen(true)}
            color={activeFilterCount ? 'primary' : 'default'}
            aria-label="Filters"
          >
            <Badge badgeContent={activeFilterCount} color="primary">
              <FilterListRoundedIcon />
            </Badge>
          </IconButton>
        </Tooltip>
        {activeFilterCount > 0 && (
          <Button size="small" onClick={clearFilters}>
            Clear
          </Button>
        )}
      </Stack>

      <Drawer anchor="right" open={filtersOpen} onClose={() => setFiltersOpen(false)}>
        <Box sx={{ width: 300, p: 2 }} role="presentation">
          <Stack direction="row" alignItems="center" sx={{ mb: 1 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 700, flex: 1 }}>
              Filters
            </Typography>
            <IconButton size="small" onClick={() => setFiltersOpen(false)} aria-label="Close">
              <CloseRoundedIcon fontSize="small" />
            </IconButton>
          </Stack>
          <Divider sx={{ mb: 2 }} />

          {/* Every change applies immediately and the table behind re-queries,
              so there is no Apply button to forget to press. */}
          <Stack spacing={2}>
            <TextField
              select
              size="small"
              label="State"
              value={stateFilter}
              onChange={(e) => setStateFilter(e.target.value)}
              fullWidth
            >
              <MenuItem value="all">All states</MenuItem>
              {US_STATES.map((st) => (
                <MenuItem key={st} value={st}>
                  {st}
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
              fullWidth
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
              fullWidth
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
              fullWidth
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
              fullWidth
            >
              <MenuItem value="all">Any</MenuItem>
              <MenuItem value="yes">Verified</MenuItem>
              <MenuItem value="no">Unverified</MenuItem>
            </TextField>

            <TextField
              select
              size="small"
              label="Merged"
              value={mergedFilter}
              onChange={(e) => setMergedFilter(e.target.value)}
              fullWidth
            >
              <MenuItem value="active">Active</MenuItem>
              <MenuItem value="merged">Merged away</MenuItem>
              <MenuItem value="all">Both</MenuItem>
            </TextField>

            <Button onClick={clearFilters} disabled={activeFilterCount === 0}>
              Clear all
            </Button>
          </Stack>
        </Box>
      </Drawer>

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
                <Stack direction="row" spacing={0.5}>
                  <Chip size="small" label={c.source ?? '—'} />
                  {c.merged_into && <Chip size="small" label="merged" color="warning" />}
                </Stack>
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

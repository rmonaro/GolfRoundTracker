import { useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Divider,
  MenuItem,
  Radio,
  Stack,
  TextField,
  Typography
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link as RouterLink } from 'react-router-dom';
import { adminCoursesRepo } from '@/services/adminCoursesRepo';
import {
  useDuplicateScan,
  useMergeCourses,
  useUnmergeCourse,
  type DuplicateGroup,
  type DuplicateMember,
  type MergeResult
} from '../hooks/useCoursesApi';

/**
 * How close two same-named courses have to be to count as the same course.
 *
 * 1 km is the default because it is comfortably wider than any golf course's
 * clubhouse-to-clubhouse error between two data sources, and far narrower than
 * the gap between two genuinely different clubs that share a name — New York
 * has a "Brae Burn" in Purchase and another in Dansville. Widen it only when
 * chasing a known pair whose coordinates disagree.
 */
const DISTANCE_OPTIONS = [0.5, 1, 2, 5];

const STATUS_COLOR: Record<string, 'default' | 'success' | 'warning' | 'error' | 'info'> = {
  synced: 'success',
  pending: 'info',
  failed: 'error',
  no_coverage: 'warning',
  skip: 'default'
};

function describeCounts(m: DuplicateMember): string {
  const parts = [
    `${m.counts.holes} holes`,
    `${m.counts.tees} tees`,
    `${m.counts.features} features`
  ];
  if (m.counts.rounds) parts.push(`${m.counts.rounds} rounds`);
  return parts.join(' · ');
}

function locationOf(m: DuplicateMember): string {
  return [m.city, m.state].filter(Boolean).join(', ') || 'no location';
}

/**
 * How far this copy sits from the suggested survivor. Worth showing: copies on
 * top of each other are one club listed twice, while a few hundred metres can
 * mean two courses sharing a facility — which must NOT be merged.
 */
function describeDistance(m: DuplicateMember): string | null {
  if (m.distanceKm == null) return null;
  if (m.distanceKm < 0.02) return 'same spot';
  return `${m.distanceKm.toFixed(2)} km away`;
}

/**
 * Duplicate courses: find them, fold them into one.
 *
 * Bulk importing a state from two providers lands the same club more than once,
 * and only one of the rows usually has OSM geometry — so the picker shows a
 * course twice and the copy the player taps decides whether auto-tracking
 * works. Merging keeps the most complete row, moves everything the others have
 * onto it, and retires them. Nothing is deleted: a merge can be undone from the
 * section at the bottom of this page.
 */
export function AdminDuplicates() {
  const queryClient = useQueryClient();
  const [maxKm, setMaxKm] = useState(1);
  const [groups, setGroups] = useState<DuplicateGroup[] | null>(null);
  const [scanned, setScanned] = useState(0);
  /** Per-group survivor choice, defaulting to the server's suggestion. */
  const [keepChoice, setKeepChoice] = useState<Record<string, string>>({});
  /** Groups already merged this session, so the card can report what moved. */
  const [merged, setMerged] = useState<Record<string, MergeResult>>({});
  const [confirming, setConfirming] = useState<DuplicateGroup | null>(null);
  const [error, setError] = useState<string | null>(null);

  const scan = useDuplicateScan();
  const mergeCourses = useMergeCourses();
  const unmerge = useUnmergeCourse();

  const mergedCourses = useQuery({
    queryKey: ['admin-merged-courses'],
    queryFn: () => adminCoursesRepo.list({ merged: 'merged', limit: 200 })
  });

  const runScan = () => {
    setError(null);
    scan.mutate(maxKm, {
      onSuccess: (res) => {
        setGroups(res.groups);
        setScanned(res.scanned);
        setKeepChoice(
          Object.fromEntries(res.groups.map((g) => [groupId(g), g.suggestedKeepId]))
        );
        setMerged({});
      },
      onError: (err) => setError((err as Error).message)
    });
  };

  const doMerge = (group: DuplicateGroup) => {
    const id = groupId(group);
    const keepId = keepChoice[id] ?? group.suggestedKeepId;
    const mergeIds = group.members.map((m) => m.id).filter((m) => m !== keepId);
    setError(null);
    mergeCourses.mutate(
      { keepId, mergeIds },
      {
        onSuccess: (res) => {
          setMerged((prev) => ({ ...prev, [id]: res }));
          setConfirming(null);
          // The library and its counters both just changed.
          queryClient.invalidateQueries({ queryKey: ['admin-all-courses'] });
          queryClient.invalidateQueries({ queryKey: ['admin-merged-courses'] });
          queryClient.invalidateQueries({ queryKey: ['courses'] });
        },
        onError: (err) => {
          setError((err as Error).message);
          setConfirming(null);
        }
      }
    );
  };

  const doUnmerge = (courseId: string) => {
    setError(null);
    unmerge.mutate(courseId, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['admin-merged-courses'] });
        queryClient.invalidateQueries({ queryKey: ['admin-all-courses'] });
        queryClient.invalidateQueries({ queryKey: ['courses'] });
      },
      onError: (err) => setError((err as Error).message)
    });
  };

  const outstanding = useMemo(
    () => (groups ?? []).filter((g) => !merged[groupId(g)]).length,
    [groups, merged]
  );

  return (
    <Box sx={{ p: 2, maxWidth: 1000 }}>
      <Typography variant="h6" sx={{ mb: 0.5 }}>
        Duplicate courses
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Courses with the same name at the same place. Merging keeps one row, moves the others&apos;
        holes, tee sets, geometry and rounds onto it, and retires them — nothing is deleted, and a
        merge can be undone below.
      </Typography>

      <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 2 }}>
        <TextField
          select
          size="small"
          label="Match within"
          value={maxKm}
          onChange={(e) => setMaxKm(Number(e.target.value))}
          sx={{ width: 150 }}
        >
          {DISTANCE_OPTIONS.map((km) => (
            <MenuItem key={km} value={km}>
              {km} km
            </MenuItem>
          ))}
        </TextField>
        <Button variant="contained" onClick={runScan} disabled={scan.isPending}>
          {scan.isPending ? 'Scanning…' : 'Scan library'}
        </Button>
        {scan.isPending && <CircularProgress size={18} />}
        {groups && !scan.isPending && (
          <Typography variant="caption" color="text.secondary">
            {scanned.toLocaleString()} courses scanned · {outstanding} group
            {outstanding === 1 ? '' : 's'} to resolve
          </Typography>
        )}
      </Stack>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {groups?.length === 0 && (
        <Alert severity="success" sx={{ mb: 2 }}>
          No duplicates found within {maxKm} km.
        </Alert>
      )}

      <Stack spacing={1.5}>
        {(groups ?? []).map((group) => {
          const id = groupId(group);
          const result = merged[id];
          const keepId = keepChoice[id] ?? group.suggestedKeepId;
          const keeper = group.members.find((m) => m.id === keepId);

          return (
            <Card key={id} variant="outlined">
              <CardContent>
                <Stack
                  direction="row"
                  alignItems="baseline"
                  spacing={1}
                  sx={{ mb: 1.5, flexWrap: 'wrap' }}
                >
                  <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                    {group.members[0].name}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {locationOf(group.members[0])} · {group.members.length} copies
                  </Typography>
                </Stack>

                {result ? (
                  <Alert severity="success">
                    Merged into <strong>{keeper?.name}</strong>. Moved {result.rounds} round
                    {result.rounds === 1 ? '' : 's'}, added {result.holes} hole
                    {result.holes === 1 ? '' : 's'} ({result.holesFilled} filled in), {result.tees}{' '}
                    tee set{result.tees === 1 ? '' : 's'} and {result.features} map feature
                    {result.features === 1 ? '' : 's'}
                    {result.fields.length
                      ? `; backfilled ${result.fields.join(', ')}`
                      : ''}
                    .
                  </Alert>
                ) : (
                  <>
                    <Stack divider={<Divider flexItem />}>
                      {group.members.map((m) => (
                        <Stack
                          key={m.id}
                          direction="row"
                          alignItems="center"
                          spacing={1}
                          sx={{ py: 0.75 }}
                        >
                          <Radio
                            size="small"
                            checked={keepId === m.id}
                            onChange={() => setKeepChoice((prev) => ({ ...prev, [id]: m.id }))}
                            inputProps={{ 'aria-label': `Keep ${m.name}` }}
                          />
                          <Box sx={{ flex: 1, minWidth: 0 }}>
                            <Typography variant="body2" sx={{ fontWeight: keepId === m.id ? 600 : 400 }}>
                              {m.name}
                              {m.id === group.suggestedKeepId && (
                                <Typography
                                  component="span"
                                  variant="caption"
                                  color="text.secondary"
                                  sx={{ ml: 1 }}
                                >
                                  suggested
                                </Typography>
                              )}
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                              {[locationOf(m), describeDistance(m), describeCounts(m)]
                                .filter(Boolean)
                                .join(' · ')}
                            </Typography>
                          </Box>
                          <Chip size="small" label={m.source ?? '—'} />
                          <Chip
                            size="small"
                            label={m.osm_status ?? '—'}
                            color={STATUS_COLOR[m.osm_status ?? ''] ?? 'default'}
                          />
                          <Button
                            size="small"
                            component={RouterLink}
                            to={`/admin/courses/${m.id}`}
                            target="_blank"
                          >
                            Open
                          </Button>
                        </Stack>
                      ))}
                    </Stack>
                    <Stack direction="row" justifyContent="flex-end" sx={{ mt: 1 }}>
                      <Button
                        size="small"
                        variant="contained"
                        disabled={mergeCourses.isPending}
                        onClick={() => setConfirming(group)}
                      >
                        Merge {group.members.length - 1} into {keeper?.name ?? 'selected'}
                      </Button>
                    </Stack>
                  </>
                )}
              </CardContent>
            </Card>
          );
        })}
      </Stack>

      {/* Merged courses — the undo list. Kept on the same page because it is
          the only place a retired course is reachable at all. */}
      <Typography variant="subtitle1" sx={{ mt: 4, mb: 1, fontWeight: 600 }}>
        Merged courses ({mergedCourses.data?.total ?? 0})
      </Typography>
      {mergedCourses.isLoading ? (
        <CircularProgress size={18} />
      ) : mergedCourses.data?.rows.length ? (
        <Stack divider={<Divider flexItem />}>
          {mergedCourses.data.rows.map((c) => (
            <Stack key={c.id} direction="row" alignItems="center" spacing={1} sx={{ py: 0.75 }}>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="body2">{c.name}</Typography>
                <Typography variant="caption" color="text.secondary">
                  {[c.city, c.state].filter(Boolean).join(', ') || 'no location'}
                  {c.merged_at ? ` · merged ${new Date(c.merged_at).toLocaleDateString()}` : ''}
                </Typography>
              </Box>
              <Button
                size="small"
                component={RouterLink}
                to={`/admin/courses/${c.merged_into}`}
                target="_blank"
              >
                Survivor
              </Button>
              <Button size="small" disabled={unmerge.isPending} onClick={() => doUnmerge(c.id)}>
                Un-merge
              </Button>
            </Stack>
          ))}
        </Stack>
      ) : (
        <Typography variant="body2" color="text.secondary">
          Nothing has been merged yet.
        </Typography>
      )}

      <Dialog open={!!confirming} onClose={() => setConfirming(null)} maxWidth="sm" fullWidth>
        <DialogTitle>Merge duplicates?</DialogTitle>
        <DialogContent>
          {confirming && (
            <DialogContentText component="div">
              <Typography variant="body2" sx={{ mb: 1.5 }}>
                Keeping{' '}
                <strong>
                  {confirming.members.find(
                    (m) => m.id === (keepChoice[groupId(confirming)] ?? confirming.suggestedKeepId)
                  )?.name}
                </strong>
                . The other {confirming.members.length - 1} will be retired.
              </Typography>
              <Typography variant="body2" component="div">
                What happens:
                <ul style={{ margin: '4px 0 0', paddingLeft: 20 }}>
                  <li>Rounds played on the duplicates move to the course you keep.</li>
                  <li>Holes, tee sets and map geometry it is missing are copied across.</li>
                  <li>The duplicates stop appearing for players, but are not deleted.</li>
                </ul>
              </Typography>
            </DialogContentText>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirming(null)}>Cancel</Button>
          <Button
            variant="contained"
            disabled={mergeCourses.isPending}
            onClick={() => confirming && doMerge(confirming)}
          >
            {mergeCourses.isPending ? 'Merging…' : 'Merge'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

/** Stable key for a group: the normalised name plus its members, since one name
 *  can produce several location clusters. */
function groupId(g: DuplicateGroup): string {
  return `${g.key}|${g.members.map((m) => m.id).sort().join(',')}`;
}

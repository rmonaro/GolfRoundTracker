import { useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Chip,
  FormControlLabel,
  LinearProgress,
  Link,
  MenuItem,
  Stack,
  TextField,
  Typography
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { adminCoursesRepo } from '@/services/adminCoursesRepo';
import {
  useBackfillCoordsApply,
  useBackfillCoordsPreview,
  useOsmSyncBatch,
  useStateImport
} from '../hooks/useCoursesApi';

const US_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DC','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA',
  'ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR',
  'PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY'
];

/** Courses per OSM batch. Each one is an Overpass round trip, so this stays
 *  small: a big batch spends its whole time budget before reporting anything,
 *  and a slow mirror takes the entire run down with it. */
// One at a time: a single course can spend 20s per mirror attempt, and the
// batch budget is 45s. Asking for more just guarantees a half-done batch.
const OSM_BATCH = 1;
/** Overpass times out often enough that a single failed batch must not end a
 *  thousand-course run. Give up only when this many fail back to back. */
const OSM_MAX_CONSECUTIVE_FAILURES = 5;
/** Backoff between consecutive failures, so a rate-limited mirror gets a
 *  breather instead of being hammered. */
const OSM_RETRY_MS = 4000;

type StageName = 'import' | 'coords' | 'osm';
type LogLine = { stage: StageName; text: string; level: 'info' | 'warn' | 'error' };

/**
 * Bulk course pipeline: pull a whole state from OpenGolfAPI, fill any
 * coordinates still missing, then work the OSM mapping queue.
 *
 * Every stage is driven from the client in small pages rather than one long
 * server call — an edge function has a wall clock, and Overpass is the slowest
 * and least reliable link in the chain. Looping here means progress is visible,
 * a failure costs one batch instead of the whole state, and Stop actually
 * stops.
 */
export function AdminStateImport() {
  const queryClient = useQueryClient();
  const [state, setState] = useState('NC');
  const [runCoords, setRunCoords] = useState(true);
  const [runOsm, setRunOsm] = useState(true);
  const [running, setRunning] = useState(false);
  const [stage, setStage] = useState<StageName | null>(null);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [log, setLog] = useState<LogLine[]>([]);
  const [totals, setTotals] = useState({ imported: 0, linked: 0, skipped: 0, synced: 0 });
  const cancelled = useRef(false);

  const { data: pendingOsm } = useQuery({
    queryKey: ['osm-pending-count'],
    queryFn: () => adminCoursesRepo.pendingOsmCount(),
    refetchInterval: running ? 15000 : false
  });

  const { data: failedOsm } = useQuery({
    queryKey: ['osm-failed-count'],
    queryFn: () => adminCoursesRepo.failedOsmCount(),
    refetchInterval: running ? 15000 : false
  });

  const requeue = useMutation({
    mutationFn: () => adminCoursesRepo.requeueFailedOsm(),
    onSuccess: (n) => {
      say('osm', `requeued ${n} failed course${n === 1 ? '' : 's'}`);
      queryClient.invalidateQueries({ queryKey: ['osm-pending-count'] });
      queryClient.invalidateQueries({ queryKey: ['osm-failed-count'] });
    }
  });

  const stateImport = useStateImport();
  const coordsPreview = useBackfillCoordsPreview();
  const coordsApply = useBackfillCoordsApply();
  const osmBatch = useOsmSyncBatch();

  const say = (stage: StageName, text: string, level: LogLine['level'] = 'info') =>
    setLog((l) => [...l, { stage, text, level }]);

  /**
   * Work the pending-OSM queue to empty, a few courses at a time.
   *
   * A batch can fail on its own — Overpass mirrors time out, rate-limit, and
   * occasionally return nothing — and a thousand-course queue must survive
   * that. Failures are logged and retried after a backoff; only a run of them
   * ends the loop.
   */
  const runOsmQueue = async () => {
    setStage('osm');
    let synced = 0;
    let remaining = Infinity;
    let failures = 0;
    let total = 0;

    while (remaining > 0 && !cancelled.current) {
      let res;
      try {
        res = await osmBatch.mutateAsync(OSM_BATCH);
      } catch (err) {
        failures++;
        say(
          'osm',
          `batch failed (${failures}/${OSM_MAX_CONSECUTIVE_FAILURES}): ${
            err instanceof Error ? err.message : 'unknown'
          }`,
          'warn'
        );
        if (failures >= OSM_MAX_CONSECUTIVE_FAILURES) {
          say('osm', 'too many consecutive failures — stopping. Re-run to resume.', 'error');
          break;
        }
        await new Promise((r) => setTimeout(r, OSM_RETRY_MS));
        continue;
      }

      failures = 0;
      if (total === 0) {
        total = res.remaining + res.processed;
        setProgress({ done: 0, total });
      }
      synced += res.processed;
      remaining = res.remaining;
      setTotals((t) => ({ ...t, synced }));
      setProgress({ done: Math.max(total - remaining, 0), total });

      const failed = res.results.filter((r) => r.status === 'failed');
      const noCoverage = res.results.filter((r) => r.status === 'no_coverage');
      say(
        'osm',
        `${res.processed} processed, ${remaining} left` +
          (failed.length ? ` — ${failed.length} failed` : '') +
          (noCoverage.length ? `, ${noCoverage.length} no coverage` : ''),
        failed.length ? 'warn' : 'info'
      );

      if (res.timedOut && res.processed === 0) {
        // Overpass was too slow to finish even one course. Not an error and
        // not an empty queue — back off and come back to it.
        say('osm', 'Overpass slow — backing off, queue untouched', 'warn');
        await new Promise((r) => setTimeout(r, OSM_RETRY_MS));
        continue;
      }
      // Nothing left to claim — the queue is empty even if `remaining` lags.
      if (res.processed === 0) break;
    }

    queryClient.invalidateQueries({ queryKey: ['admin-stats'] });
    queryClient.invalidateQueries({ queryKey: ['osm-pending-count'] });
  };

  /** Work the OSM queue on its own, without re-importing anything. */
  const runOsmOnly = async () => {
    cancelled.current = false;
    setRunning(true);
    setLog([]);
    setTotals({ imported: 0, linked: 0, skipped: 0, synced: 0 });
    setProgress({ done: 0, total: 0 });
    try {
      await runOsmQueue();
      say('osm', cancelled.current ? 'stopped' : 'done');
    } catch (err) {
      say('osm', err instanceof Error ? err.message : 'Unknown error', 'error');
    } finally {
      setRunning(false);
      setStage(null);
    }
  };

  const run = async () => {
    cancelled.current = false;
    setRunning(true);
    setLog([]);
    setTotals({ imported: 0, linked: 0, skipped: 0, synced: 0 });
    setProgress({ done: 0, total: 0 });

    try {
      // ---- Stage 1: import the state, page by page ----------------------
      setStage('import');
      let offset: number | null = 0;
      let imported = 0;
      let linked = 0;
      let skipped = 0;

      while (offset !== null && !cancelled.current) {
        const res = await stateImport.mutateAsync({ state, offset, limit: 250 });
        imported += res.imported;
        linked += res.linked;
        skipped += res.skipped;
        setTotals((t) => ({ ...t, imported, linked, skipped }));
        setProgress({ done: Math.min(offset + res.scanned, res.total), total: res.total });
        say(
          'import',
          `${offset + 1}–${offset + res.scanned} of ${res.total}: ${res.imported} new, ${res.linked} linked, ${res.skipped} already linked`
        );
        // Name matching can't be perfect, so every link is printed with its
        // score and distance — a wrong one is obvious here and fixable on the
        // course page, rather than silently wrong forever.
        for (const l of res.links) {
          say(
            'import',
            `  linked "${l.localName}" → "${l.matchName}" (${l.score}${l.km != null ? `, ${l.km}km` : ''})`,
            l.score < 0.9 ? 'warn' : 'info'
          );
        }
        offset = res.nextOffset;
      }

      queryClient.invalidateQueries({ queryKey: ['admin-all-courses'] });
      queryClient.invalidateQueries({ queryKey: ['courses'] });
      if (cancelled.current) return;

      // ---- Stage 2: fill any coordinates still missing --------------------
      // State-imported courses always arrive with coordinates, so this only
      // catches courses that were already in the library without them.
      if (runCoords) {
        setStage('coords');
        setProgress({ done: 0, total: 0 });
        const preview = await coordsPreview.mutateAsync(100);
        const confident = preview.proposals.filter((p) => p.match && p.confidence !== 'weak');
        const weak = preview.proposals.length - confident.length;

        if (confident.length > 0) {
          const applied = await coordsApply.mutateAsync(
            confident.map((p) => ({ courseId: p.courseId, lat: p.match!.lat, lng: p.match!.lng }))
          );
          say('coords', `filled ${applied.updated} of ${preview.proposals.length} missing`);
        } else {
          say('coords', `nothing confident to fill (${preview.proposals.length} scanned)`);
        }
        if (weak > 0) {
          say(
            'coords',
            `${weak} left for review — check them on the Courses tab under "Backfill coords"`,
            'warn'
          );
        }
      }
      if (cancelled.current) return;

      // ---- Stage 3: work the OSM queue -----------------------------------
      if (runOsm) await runOsmQueue();

      say(runOsm ? 'osm' : 'import', cancelled.current ? 'stopped' : 'done');
    } catch (err) {
      say(stage ?? 'import', err instanceof Error ? err.message : 'Unknown error', 'error');
    } finally {
      setRunning(false);
      setStage(null);
    }
  };

  const pct = progress.total > 0 ? (100 * progress.done) / progress.total : 0;

  return (
    <Box sx={{ p: 2, pb: 14 }}>
      <Card elevation={0}>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Import a state
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Pulls every course OpenGolfAPI holds for a state, links the ones already
            in the library instead of duplicating them, then fills missing
            coordinates and runs OSM mapping. Safe to re-run — courses already
            linked are skipped.
          </Typography>

          <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap" useFlexGap>
            <TextField
              select
              size="small"
              label="State"
              value={state}
              onChange={(e) => setState(e.target.value)}
              disabled={running}
              sx={{ minWidth: 120 }}
            >
              {US_STATES.map((s) => (
                <MenuItem key={s} value={s}>
                  {s}
                </MenuItem>
              ))}
            </TextField>
            <FormControlLabel
              control={
                <Checkbox
                  checked={runCoords}
                  onChange={(e) => setRunCoords(e.target.checked)}
                  disabled={running}
                />
              }
              label="Fill missing coords"
            />
            <FormControlLabel
              control={
                <Checkbox
                  checked={runOsm}
                  onChange={(e) => setRunOsm(e.target.checked)}
                  disabled={running}
                />
              }
              label="Run OSM mapping"
            />
            {running ? (
              <Button
                variant="outlined"
                color="warning"
                onClick={() => {
                  cancelled.current = true;
                }}
              >
                Stop after this batch
              </Button>
            ) : (
              <>
                <Button variant="contained" onClick={run}>
                  Run
                </Button>
                <Button
                  variant="outlined"
                  onClick={runOsmOnly}
                  disabled={!pendingOsm}
                  title="Work the pending-OSM queue without importing anything"
                >
                  OSM only{pendingOsm ? ` (${pendingOsm.toLocaleString()})` : ''}
                </Button>
                <Button
                  variant="text"
                  onClick={() => requeue.mutate()}
                  disabled={!failedOsm || requeue.isPending}
                  title="Put courses whose last sync failed back on the queue"
                >
                  Retry failed{failedOsm ? ` (${failedOsm.toLocaleString()})` : ''}
                </Button>
              </>
            )}
          </Stack>

          {(running || progress.total > 0) && (
            <Box sx={{ mt: 2 }}>
              <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
                {stage && <Chip size="small" label={stage} color="primary" />}
                <Typography variant="caption" color="text.secondary">
                  {progress.done} / {progress.total || '—'}
                </Typography>
              </Stack>
              <LinearProgress
                variant={progress.total > 0 ? 'determinate' : 'indeterminate'}
                value={pct}
              />
            </Box>
          )}

          <Stack direction="row" spacing={1} sx={{ mt: 2 }} flexWrap="wrap" useFlexGap>
            <Chip size="small" label={`${totals.imported} imported`} color="success" />
            <Chip size="small" label={`${totals.linked} linked`} color="info" />
            <Chip size="small" label={`${totals.skipped} already linked`} />
            <Chip size="small" label={`${totals.synced} OSM synced`} />
          </Stack>

          <Alert severity="info" sx={{ mt: 2 }}>
            {pendingOsm ? `${pendingOsm.toLocaleString()} courses are waiting on OSM geometry. ` : ''}
            OSM mapping runs {OSM_BATCH} at a time through Overpass and is the slow
            part — a large state takes hours. A failed batch is retried rather than
            ending the run, and stopping is safe: the queue resumes where it left
            off, so "OSM only" can be run again later.
          </Alert>
        </CardContent>
      </Card>

      {log.length > 0 && (
        <Card elevation={0} sx={{ mt: 2 }}>
          <CardContent>
            <Typography variant="subtitle2" gutterBottom>
              Log
            </Typography>
            <Box
              sx={{
                maxHeight: 320,
                overflowY: 'auto',
                fontFamily: 'monospace',
                fontSize: 12
              }}
            >
              {log.map((l, i) => (
                <Typography
                  key={i}
                  variant="caption"
                  component="div"
                  color={
                    l.level === 'error'
                      ? 'error.main'
                      : l.level === 'warn'
                        ? 'warning.main'
                        : 'text.secondary'
                  }
                >
                  [{l.stage}] {l.text}
                </Typography>
              ))}
            </Box>
          </CardContent>
        </Card>
      )}

      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 2 }}>
        Course data © OpenStreetMap contributors (ODbL 1.0) via OpenGolfAPI —{' '}
        <Link href="https://opengolfapi.org/attribution" target="_blank" rel="noreferrer">
          attribution
        </Link>
      </Typography>
    </Box>
  );
}

import { useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  FormControlLabel,
  LinearProgress,
  MenuItem,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography
} from '@mui/material';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  useTeeBulkImport,
  useTeeGapScan,
  type TeeGapCourse,
  type TeeGapScanResult
} from '../hooks/useCoursesApi';

const US_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DC','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA',
  'ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR',
  'PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY'
];

/**
 * Courses per batch. Each one is two OpenGolfAPI round trips, and the function
 * cuts a batch short at its own time budget rather than running past the wall
 * clock — so this is sized for visible progress, not throughput.
 */
const BATCH = 10;
/** A run of a few thousand courses has to survive a bad response or two. */
const MAX_CONSECUTIVE_FAILURES = 4;
const RETRY_MS = 3000;
/** How many rows the preview table shows before it stops being a table. */
const PREVIEW_ROWS = 200;

type LogLine = { text: string; level: 'info' | 'warn' | 'error' };

/**
 * Tee sets: which courses have none, and a way to fill them in.
 *
 * A tee set is what makes a round's numbers real — it stamps the rating and
 * slope, seeds every hole's yardage, and puts the tee marker on the box the
 * player actually walked to. The library arrived from a bulk state import,
 * which brings names and coordinates but no scorecard, so almost every course
 * starts with none. Doing them one at a time from the course detail page is not
 * a realistic amount of clicking.
 *
 * The run is driven from here in small batches rather than one long server
 * call: progress stays visible, a failure costs one batch instead of the whole
 * library, and Stop actually stops.
 */
export function AdminTees() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [state, setState] = useState('all');
  const [syncedOnly, setSyncedOnly] = useState(true);
  const [scan, setScan] = useState<TeeGapScanResult | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [totals, setTotals] = useState({ imported: 0, noScorecard: 0, failed: 0, tees: 0 });
  const [log, setLog] = useState<LogLine[]>([]);
  const [error, setError] = useState<string | null>(null);
  const cancelled = useRef(false);

  const teeGapScan = useTeeGapScan();
  const teeBulkImport = useTeeBulkImport();

  const say = (text: string, level: LogLine['level'] = 'info') =>
    setLog((l) => [...l, { text, level }]);

  /** Only linked courses can be imported in bulk — see the note on the action. */
  const importable = useMemo(
    () => (scan?.courses ?? []).filter((c) => c.opengolf_id),
    [scan]
  );

  const runScan = () => {
    setError(null);
    setLog([]);
    teeGapScan.mutate(
      { state, syncedOnly },
      {
        onSuccess: (res) => {
          setScan(res);
          setTotals({ imported: 0, noScorecard: 0, failed: 0, tees: 0 });
          setProgress({ done: 0, total: 0 });
        },
        onError: (err) => setError((err as Error).message)
      }
    );
  };

  const runImport = async () => {
    if (!importable.length) return;
    cancelled.current = false;
    setRunning(true);
    setError(null);
    setLog([]);
    setProgress({ done: 0, total: importable.length });
    const running = { imported: 0, noScorecard: 0, failed: 0, tees: 0 };
    let consecutiveFailures = 0;
    let index = 0;

    while (index < importable.length && !cancelled.current) {
      const batch = importable.slice(index, index + BATCH);
      let res;
      try {
        res = await teeBulkImport.mutateAsync(batch.map((c) => c.id));
      } catch (err) {
        consecutiveFailures++;
        say(
          `batch failed (${consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES}): ${
            err instanceof Error ? err.message : 'unknown'
          }`,
          'warn'
        );
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          say('too many consecutive failures — stopping. Re-scan to resume.', 'error');
          break;
        }
        await new Promise((r) => setTimeout(r, RETRY_MS));
        continue;
      }

      consecutiveFailures = 0;
      for (const r of res.results) {
        if (r.status === 'imported') {
          running.imported++;
          running.tees += r.tees ?? 0;
          if (!r.tees) say(`${r.name}: holes updated but no tee sets published`, 'warn');
        } else if (r.status === 'no_scorecard') {
          running.noScorecard++;
          say(`${r.name}: OpenGolfAPI has no scorecard`, 'warn');
        } else if (r.status === 'failed') {
          running.failed++;
          say(`${r.name}: ${r.error ?? 'failed'}`, 'error');
        }
      }
      setTotals({ ...running });

      // The server stops mid-batch at its time budget, so advance by what it
      // actually processed rather than by the batch size — otherwise the tail
      // of a cut-short batch is silently skipped.
      index += Math.max(res.processed, 1);
      setProgress({ done: Math.min(index, importable.length), total: importable.length });
    }

    if (cancelled.current) say('stopped', 'warn');
    else if (index >= importable.length) say('done', 'info');
    setRunning(false);
    // Tee counts feed the course detail page and the player picker.
    queryClient.invalidateQueries({ queryKey: ['admin-all-courses'] });
    queryClient.invalidateQueries({ queryKey: ['course-tees'] });
  };

  const missing = scan?.courses.length ?? 0;

  return (
    <Box sx={{ p: 2, maxWidth: 1000 }}>
      <Typography variant="h6" sx={{ mb: 0.5 }}>
        Tee sets
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Courses with no tee sets. Without one a round has no rating, no per-hole yardage and no tee
        marker on the map. Importing pulls the scorecard from OpenGolfAPI — two requests per course.
      </Typography>

      <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 2, flexWrap: 'wrap' }}>
        <TextField
          select
          size="small"
          label="State"
          value={state}
          onChange={(e) => setState(e.target.value)}
          sx={{ width: 120 }}
          disabled={running}
        >
          <MenuItem value="all">All states</MenuItem>
          {US_STATES.map((s) => (
            <MenuItem key={s} value={s}>
              {s}
            </MenuItem>
          ))}
        </TextField>
        <FormControlLabel
          control={
            <Switch
              size="small"
              checked={syncedOnly}
              onChange={(e) => setSyncedOnly(e.target.checked)}
              disabled={running}
            />
          }
          label={
            <Typography variant="body2">
              Mapped courses only
            </Typography>
          }
        />
        <Button variant="outlined" onClick={runScan} disabled={teeGapScan.isPending || running}>
          {teeGapScan.isPending ? 'Scanning…' : 'Scan'}
        </Button>
        {teeGapScan.isPending && <CircularProgress size={18} />}
      </Stack>

      {/* Only courses already linked to OpenGolfAPI are importable: matching a
          course by name is a guess, and a wrong guess writes some other club's
          scorecard onto this one. */}
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 2 }}>
        Only courses already linked to OpenGolfAPI are imported in bulk. Unlinked ones need a name
        match confirmed on the course page first.
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {scan && (
        <>
          <Alert severity={missing === 0 ? 'success' : 'info'} sx={{ mb: 2 }}>
            {missing === 0 ? (
              <>All {scan.scanned.toLocaleString()} courses have tee sets.</>
            ) : (
              <>
                {missing.toLocaleString()} of {scan.scanned.toLocaleString()} courses have no tee
                sets — {scan.linked.toLocaleString()} can be imported now,{' '}
                {scan.unlinked.toLocaleString()} need a manual match.{' '}
                {scan.withTees.toLocaleString()} already have them.
              </>
            )}
          </Alert>

          {!!importable.length && (
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 2 }}>
              <Button
                variant="contained"
                onClick={runImport}
                disabled={running}
              >
                Import {importable.length.toLocaleString()} scorecard
                {importable.length === 1 ? '' : 's'}
              </Button>
              {running && (
                <Button
                  color="warning"
                  onClick={() => {
                    cancelled.current = true;
                  }}
                >
                  Stop
                </Button>
              )}
              <Typography variant="caption" color="text.secondary">
                ~{(importable.length * 2).toLocaleString()} API requests
              </Typography>
            </Stack>
          )}

          {progress.total > 0 && (
            <Box sx={{ mb: 2 }}>
              <LinearProgress
                variant="determinate"
                value={(progress.done / progress.total) * 100}
                sx={{ mb: 0.5 }}
              />
              <Typography variant="caption" color="text.secondary">
                {progress.done.toLocaleString()} / {progress.total.toLocaleString()} ·{' '}
                {totals.imported.toLocaleString()} imported ({totals.tees.toLocaleString()} tee
                sets)
                {totals.noScorecard ? ` · ${totals.noScorecard} with no scorecard` : ''}
                {totals.failed ? ` · ${totals.failed} failed` : ''}
              </Typography>
            </Box>
          )}

          {!!log.length && (
            <Box
              sx={{
                mb: 2,
                maxHeight: 200,
                overflowY: 'auto',
                bgcolor: 'background.paper',
                borderRadius: 1,
                p: 1
              }}
            >
              {log.map((line, i) => (
                <Typography
                  key={i}
                  variant="caption"
                  component="div"
                  color={
                    line.level === 'error'
                      ? 'error.main'
                      : line.level === 'warn'
                        ? 'warning.main'
                        : 'text.secondary'
                  }
                >
                  {line.text}
                </Typography>
              ))}
            </Box>
          )}

          {!!missing && (
            <>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Name</TableCell>
                    <TableCell>Location</TableCell>
                    <TableCell>Source</TableCell>
                    <TableCell>OSM</TableCell>
                    <TableCell>Linked</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {scan.courses.slice(0, PREVIEW_ROWS).map((c: TeeGapCourse) => (
                    <TableRow
                      key={c.id}
                      hover
                      sx={{ cursor: 'pointer' }}
                      onClick={() => navigate(`/admin/courses/${c.id}`)}
                    >
                      <TableCell sx={{ fontWeight: 600 }}>{c.name}</TableCell>
                      <TableCell>
                        {[c.city, c.state].filter(Boolean).join(', ') || '—'}
                      </TableCell>
                      <TableCell>
                        <Chip size="small" label={c.source ?? '—'} />
                      </TableCell>
                      <TableCell>
                        <Chip
                          size="small"
                          label={c.osm_status ?? '—'}
                          color={c.osm_status === 'synced' ? 'success' : 'default'}
                        />
                      </TableCell>
                      <TableCell>
                        {c.opengolf_id ? (
                          <Chip size="small" color="info" label="linked" />
                        ) : (
                          <Chip size="small" color="warning" label="manual" />
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {missing > PREVIEW_ROWS && (
                <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                  Showing the first {PREVIEW_ROWS} of {missing.toLocaleString()}. Import runs over
                  all of them.
                </Typography>
              )}
            </>
          )}
        </>
      )}
    </Box>
  );
}

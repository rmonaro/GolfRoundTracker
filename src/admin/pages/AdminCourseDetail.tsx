import { useState } from 'react';
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
  DialogTitle,
  Stack,
  TextField,
  Typography
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import VerifiedRoundedIcon from '@mui/icons-material/VerifiedRounded';
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded';
import { adminCoursesRepo } from '@/services/adminCoursesRepo';
import { useResyncCourse, useImportCourse } from '../hooks/useCoursesApi';
import { HoleLayoutCard } from '@/features/course/HoleLayoutCard';
import { CourseEditDialog } from '../components/CourseEditDialog';
import { ScorecardImportDialog } from '../components/ScorecardImportDialog';
import { CourseTeesCard } from '../components/CourseTeesCard';

export function AdminCourseDetail() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const [holeNumber, setHoleNumber] = useState(1);
  const [editOpen, setEditOpen] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [scorecardOpen, setScorecardOpen] = useState(false);
  const [pastedJson, setPastedJson] = useState('');
  const resync = useResyncCourse();
  const reimport = useImportCourse();

  const { data: course, isLoading } = useQuery({
    queryKey: ['admin-course', id],
    enabled: !!id,
    queryFn: () => adminCoursesRepo.getOne(id!)
  });

  const verify = useMutation({
    mutationFn: (next: boolean) => adminCoursesRepo.setVerified(id!, next),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-course', id] });
      queryClient.invalidateQueries({ queryKey: ['admin-all-courses'] });
    }
  });

  if (!id) return <Navigate to="/admin/courses" replace />;
  if (isLoading || !course) {
    return (
      <Box sx={{ display: 'grid', placeItems: 'center', py: 6 }}>
        <CircularProgress />
      </Box>
    );
  }

  const invalidateAfterSync = () => {
    queryClient.invalidateQueries({ queryKey: ['admin-course', id] });
    queryClient.invalidateQueries({ queryKey: ['admin-all-courses'] });
    queryClient.invalidateQueries({ queryKey: ['admin-stats'] });
    queryClient.invalidateQueries({ queryKey: ['hole-layout'] });
  };

  const onResync = () => {
    resync.mutate({ courseId: course.id }, { onSuccess: invalidateAfterSync });
  };

  // Re-fetch the GolfCourseAPI detail and re-upsert the course (matched on
  // course_api_id) — this is how courses imported before tee-parsing existed
  // pick up their `course_tees` rows. Also refreshes the start-round tee picker.
  const onReimport = () => {
    if (!course.course_api_id) return;
    reimport.mutate(course.course_api_id, {
      onSuccess: () => {
        invalidateAfterSync();
        queryClient.invalidateQueries({ queryKey: ['course-tees', course.id] });
      }
    });
  };

  const onSyncFromPaste = () => {
    resync.mutate(
      { courseId: course.id, overpassJson: pastedJson },
      {
        onSuccess: () => {
          invalidateAfterSync();
          setPasteOpen(false);
          setPastedJson('');
        }
      }
    );
  };

  // Same query the edge function runs. Surfaced as a deep link so the admin
  // can see exactly what Overpass returns (or doesn't) for these coords.
  const radius = course.search_radius ?? 1500;
  const overpassQuery =
    course.lat != null && course.lng != null
      ? `[out:json][timeout:25];\n(\n  way["golf"](around:${radius},${course.lat},${course.lng});\n  relation["golf"](around:${radius},${course.lat},${course.lng});\n);\nout geom;`
      : '';
  const overpassTurboUrl =
    course.lat != null && course.lng != null
      ? `https://overpass-turbo.eu/?Q=${encodeURIComponent(overpassQuery)}&C=${course.lat};${course.lng};16&R`
      : '';

  return (
    <Stack spacing={2} sx={{ p: 2 }}>
      <Box>
        <Button
          startIcon={<ArrowBackRoundedIcon />}
          onClick={() => navigate('/admin/courses')}
        >
          Back to courses
        </Button>
      </Box>
      <Card elevation={0} sx={{ bgcolor: 'background.paper' }}>
        <CardContent>
          <Typography variant="h6">{course.name}</Typography>
          {course.club_name && (
            <Typography variant="body2" color="text.secondary">
              {course.club_name}
            </Typography>
          )}
          <Typography variant="caption" color="text.secondary">
            {[course.city, course.state, course.country].filter(Boolean).join(', ') || '—'}
          </Typography>
          <Stack direction="row" spacing={0.5} mt={1} flexWrap="wrap" useFlexGap>
            <Chip
              size="small"
              color={course.verified ? 'primary' : 'default'}
              variant={course.verified ? 'filled' : 'outlined'}
              icon={course.verified ? <VerifiedRoundedIcon sx={{ fontSize: 16 }} /> : undefined}
              label={course.verified ? 'verified' : 'unverified'}
            />
            <Chip size="small" label={`source: ${course.source ?? '—'}`} />
            <Chip size="small" label={`osm: ${course.osm_status ?? '—'}`} />
            {course.course_api_id && <Chip size="small" label={`api id: ${course.course_api_id}`} />}
          </Stack>
          <Stack direction="row" spacing={1} mt={2} flexWrap="wrap" useFlexGap>
            <Button variant="contained" onClick={() => setEditOpen(true)}>
              Edit
            </Button>
            <Button
              variant="outlined"
              onClick={onResync}
              disabled={resync.isPending || course.lat == null || course.lng == null}
            >
              {resync.isPending ? 'Syncing…' : 'Resync OSM'}
            </Button>
            <Button
              variant="outlined"
              onClick={onReimport}
              disabled={reimport.isPending || !course.course_api_id}
              title={
                course.course_api_id
                  ? 'Re-fetch from GolfCourseAPI (refreshes tee sets)'
                  : 'No GolfCourseAPI id — this course was added manually'
              }
            >
              {reimport.isPending ? 'Re-importing…' : 'Re-import (tees)'}
            </Button>
            <Button
              variant="outlined"
              onClick={() => setPasteOpen(true)}
              disabled={resync.isPending}
            >
              Sync from JSON
            </Button>
            <Button
              variant="outlined"
              onClick={() => setScorecardOpen(true)}
              title="Import par + stroke index and tee sets from OpenGolfAPI (ODbL)"
            >
              Import scorecard
            </Button>
            <Button
              variant={course.verified ? 'outlined' : 'contained'}
              color={course.verified ? 'inherit' : 'primary'}
              startIcon={<VerifiedRoundedIcon />}
              onClick={() => verify.mutate(!course.verified)}
              disabled={verify.isPending}
            >
              {verify.isPending
                ? 'Saving…'
                : course.verified
                  ? 'Unverify'
                  : 'Verify (make public)'}
            </Button>
            <Button
              variant="text"
              disabled={!course.lat || !course.lng}
              onClick={() =>
                window.open(
                  `https://www.openstreetmap.org/?mlat=${course.lat}&mlon=${course.lng}#map=16/${course.lat}/${course.lng}`,
                  '_blank'
                )
              }
            >
              Open in OSM
            </Button>
            <Button
              variant="text"
              disabled={!overpassTurboUrl}
              onClick={() => window.open(overpassTurboUrl, '_blank')}
            >
              Inspect on Overpass Turbo
            </Button>
          </Stack>
          {(course.lat == null || course.lng == null) && (
            <Alert severity="info" sx={{ mt: 1.5 }}>
              This course has no lat/lng — tap <strong>Edit</strong> to add coordinates
              before syncing OSM geometry.
            </Alert>
          )}
          {course.osm_status === 'no_coverage' &&
            course.lat != null &&
            course.lng != null && (
              <Alert severity="warning" sx={{ mt: 1.5 }}>
                <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>
                  Overpass returned zero <code>golf=*</code> features around these
                  coordinates (radius {radius}m).
                </Typography>
                <Typography variant="body2" component="div">
                  Common fixes, in order of likelihood:
                  <Box component="ol" sx={{ mt: 0.5, mb: 0, pl: 2.5 }}>
                    <li>
                      <strong>Bump the search radius</strong> via Edit — many courses
                      span 2km+; try 3000m or 5000m.
                    </li>
                    <li>
                      <strong>Verify lat/lng</strong> — the address geocode may have
                      landed on the clubhouse driveway rather than the course. Open in
                      OSM, zoom on the actual fairway, and copy coords from the URL.
                    </li>
                    <li>
                      <strong>Inspect on Overpass Turbo</strong> (button above) to see
                      what's actually tagged within {radius}m. If the result is empty
                      but the boundary shows on osm.org, the course has{' '}
                      <code>leisure=golf_course</code> but no per-hole{' '}
                      <code>golf=*</code> features — we can't render holes without
                      them.
                    </li>
                  </Box>
                </Typography>
              </Alert>
            )}
          {resync.error && (
            <Alert severity="error" sx={{ mt: 1 }}>
              {(resync.error as Error).message}
            </Alert>
          )}
          {verify.error && (
            <Alert severity="error" sx={{ mt: 1 }}>
              {(verify.error as Error).message}
            </Alert>
          )}
          {reimport.error && (
            <Alert severity="error" sx={{ mt: 1 }}>
              {(reimport.error as Error).message}
            </Alert>
          )}
          {reimport.data && (
            <Alert severity="success" sx={{ mt: 1 }}>
              Re-imported from GolfCourseAPI — tee sets refreshed.
            </Alert>
          )}
          {resync.data && (
            <Alert
              severity={
                resync.data.ok
                  ? resync.data.status === 'synced'
                    ? 'success'
                    : 'warning'
                  : 'error'
              }
              sx={{ mt: 1 }}
            >
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                {resync.data.status} — holes: {resync.data.holes ?? 0}, features:{' '}
                {resync.data.features ?? 0}
              </Typography>
              {resync.data.error && (
                <Typography variant="body2" sx={{ mt: 0.5 }}>
                  {resync.data.error}
                </Typography>
              )}
              {resync.data.diagnostics && (
                <Box component="div" sx={{ mt: 1, fontSize: '0.8rem' }}>
                  <div>
                    Overpass returned <strong>{resync.data.diagnostics.overpassElements}</strong>{' '}
                    element{resync.data.diagnostics.overpassElements === 1 ? '' : 's'}.
                  </div>
                  {Object.keys(resync.data.diagnostics.golfTagCounts).length > 0 && (
                    <div>
                      golf=* breakdown:{' '}
                      {Object.entries(resync.data.diagnostics.golfTagCounts)
                        .map(([tag, n]) => `${tag}=${n}`)
                        .join(', ')}
                    </div>
                  )}
                  {(resync.data.diagnostics.waysWithUnresolvedNodes ?? 0) > 0 && (
                    <div>
                      <strong>{resync.data.diagnostics.waysWithUnresolvedNodes}</strong> way(s)
                      reference node ids that aren&apos;t in this payload. The export
                      carried the ways but not their nodes — retrying won&apos;t help.
                      Re-export ending in <code>out geom;</code>, or{' '}
                      <code>out body; &gt;; out skel qt;</code> so the nodes come too.
                    </div>
                  )}
                  {resync.data.diagnostics.golfTaggedWithoutGeometry > 0 && (
                    <div>
                      <strong>
                        {resync.data.diagnostics.golfTaggedWithoutGeometry}
                      </strong>{' '}
                      golf-tagged element(s) had no geometry attached — likely an
                      Overpass partial response. Retry the sync.
                    </div>
                  )}
                  {resync.data.diagnostics.holeWaysWithoutRef > 0 && (
                    <div>
                      <strong>{resync.data.diagnostics.holeWaysWithoutRef}</strong>{' '}
                      golf=hole way(s) lacked a <code>ref</code> tag (hole number) and
                      were skipped. We can still build holes from green+tee polygons if
                      those exist.
                    </div>
                  )}
                  {(resync.data.diagnostics.holeRefLabels?.length ?? 0) > 1 && (
                    <div>
                      This extract covers <strong>more than one course</strong>. Hole
                      refs carry these labels:{' '}
                      <strong>{resync.data.diagnostics.holeRefLabels!.join(', ')}</strong>.
                      Set <em>Hole ref filter</em> in Edit to this course&apos;s label so
                      only its holes are imported.
                    </div>
                  )}
                  {resync.data.diagnostics.holeRefFilter && (
                    <div>
                      Ref filter <code>{resync.data.diagnostics.holeRefFilter}</code> kept{' '}
                      <strong>{resync.data.diagnostics.holesAfterRefFilter ?? 0}</strong>{' '}
                      hole(s).
                    </div>
                  )}
                  {resync.data.diagnostics.overpassRemark && (
                    <div>
                      <strong>Overpass remark:</strong>{' '}
                      {resync.data.diagnostics.overpassRemark}
                    </div>
                  )}
                  {resync.data.diagnostics.mirror && (
                    <div>
                      Mirror used: <code>{resync.data.diagnostics.mirror}</code>
                    </div>
                  )}
                  {resync.data.diagnostics.attemptedMirrors &&
                    resync.data.diagnostics.attemptedMirrors.length > 1 && (
                      <div>
                        Tried:{' '}
                        {resync.data.diagnostics.attemptedMirrors.join(' → ')}
                      </div>
                    )}
                  {resync.data.diagnostics.attemptDetails &&
                    resync.data.diagnostics.attemptDetails.length > 0 && (
                      <Box
                        component="ul"
                        sx={{
                          mt: 0.75,
                          mb: 0,
                          pl: 2,
                          fontFamily: 'ui-monospace, SFMono-Regular, monospace',
                          fontSize: '0.7rem'
                        }}
                      >
                        {resync.data.diagnostics.attemptDetails.map((d, i) => (
                          <li key={i}>
                            <strong>{d.id}</strong> → {String(d.status)} (
                            {d.bodyChars} chars)
                            {d.error ? ` — ${d.error}` : ''}
                            {d.snippet
                              ? `: ${d.snippet.replace(/\s+/g, ' ').slice(0, 120)}`
                              : ''}
                          </li>
                        ))}
                      </Box>
                    )}
                </Box>
              )}
            </Alert>
          )}
        </CardContent>
      </Card>

      <Card elevation={0} sx={{ bgcolor: 'background.paper' }}>
        <CardContent>
          <Typography variant="subtitle1" mb={1}>
            Hole {holeNumber} preview
          </Typography>
          <Box sx={{ height: 320 }}>
            <HoleLayoutCard courseId={course.id} holeNumber={holeNumber} />
          </Box>
          <Stack direction="row" spacing={0.5} mt={1} flexWrap="wrap" useFlexGap>
            {Array.from({ length: 18 }, (_, i) => i + 1).map((n) => (
              <Button
                key={n}
                size="small"
                variant={holeNumber === n ? 'contained' : 'outlined'}
                onClick={() => setHoleNumber(n)}
                sx={{ minWidth: 36, px: 1 }}
              >
                {n}
              </Button>
            ))}
          </Stack>
        </CardContent>
      </Card>

      <CourseTeesCard courseId={course.id} />

      <CourseEditDialog
        open={editOpen}
        course={course}
        onClose={() => setEditOpen(false)}
      />

      <ScorecardImportDialog
        open={scorecardOpen}
        courseId={course.id}
        onClose={() => setScorecardOpen(false)}
      />

      <Dialog
        open={pasteOpen}
        onClose={() => {
          if (resync.isPending) return;
          setPasteOpen(false);
        }}
        fullWidth
        maxWidth="md"
      >
        <DialogTitle>Sync from pasted Overpass JSON</DialogTitle>
        <DialogContent dividers>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            When our edge function can't reach the Overpass mirrors (IP blocking),
            you can fetch the same query in your browser and paste the result here:
          </Typography>
          <Box
            component="ol"
            sx={{ mt: 0, mb: 2, pl: 3, fontSize: '0.85rem', color: 'text.secondary' }}
          >
            <li>Tap <strong>Inspect on Overpass Turbo</strong> on this page to open the exact query.</li>
            <li>In Overpass Turbo, click <strong>Data</strong> in the top right.</li>
            <li>Select all (Cmd/Ctrl+A) and copy.</li>
            <li>Paste below and click Sync.</li>
          </Box>
          <TextField
            label="Overpass JSON"
            multiline
            minRows={10}
            maxRows={20}
            fullWidth
            value={pastedJson}
            onChange={(e) => setPastedJson(e.target.value)}
            placeholder='{"version":0.6,"generator":"Overpass API",…,"elements":[…]}'
            slotProps={{
              htmlInput: {
                style: {
                  fontFamily: 'ui-monospace, SFMono-Regular, monospace',
                  fontSize: '0.75rem'
                }
              }
            }}
          />
          {resync.error && (
            <Alert severity="error" sx={{ mt: 1.5 }}>
              {(resync.error as Error).message}
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPasteOpen(false)} disabled={resync.isPending}>
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={onSyncFromPaste}
            disabled={resync.isPending || pastedJson.trim().length === 0}
          >
            {resync.isPending ? 'Syncing…' : 'Sync'}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}

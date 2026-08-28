import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardActionArea,
  CardContent,
  Chip,
  CircularProgress,
  Stack,
  TextField,
  Typography
} from '@mui/material';
import { useNavigate, useParams } from 'react-router-dom';
import { PageHeader } from '@/components/layout/PageHeader';
import { ToggleGroup } from '@/components/ui/ToggleGroup';
import { CoursePackButton } from '@/features/offline/CoursePackButton';
import { downloadPackInBackground } from '@/services/coursePackRepo';
import { useCourses, useCourseTees, useStartRound } from '@/features/round/useStartRound';
import { toAppError } from '@/services/errors';
import { watchBridge } from '@/services/watchBridge';
import {
  defaultTee,
  localDateInputToIso,
  teeHoleYardages,
  toLocalDateInput
} from '@/features/round/startRoundForm';
import type { CourseTee } from '@/models';

type HoleChoice = '9' | '18' | 'custom';

/**
 * Step 2 of starting a round: which tee, and how many holes.
 *
 * Everything here needs the course to already be known, which is why it's a
 * separate screen from the picker rather than a section that appears under it.
 * Confirming starts the round and drops the golfer straight onto the course.
 */
export function RoundSetupPage() {
  const navigate = useNavigate();
  const { courseId = '' } = useParams<{ courseId: string }>();
  const courses = useCourses();
  const startRound = useStartRound();

  const course = courses.data?.find((c) => c.id === courseId) ?? null;
  const teesQuery = useCourseTees(courseId || null);
  const tees = useMemo(() => teesQuery.data ?? [], [teesQuery.data]);

  const [selectedTeeId, setSelectedTeeId] = useState('');
  const [holeChoice, setHoleChoice] = useState<HoleChoice>('18');
  const [customHoles, setCustomHoles] = useState(9);
  // YYYY-MM-DD local. Defaults to today so the normal "start a round now" path
  // needs no input; an earlier date backdates a round already played.
  const [roundDate, setRoundDate] = useState(() => toLocalDateInput(new Date()));
  const [error, setError] = useState<string | null>(null);

  const selectedTee = tees.find((t) => t.id === selectedTeeId) ?? null;

  // Start pulling the course's satellite imagery now. This screen is the last
  // point where wifi is likely — by the time the round begins the golfer is
  // usually at the course on cellular, or with no signal at all. No-ops when
  // the pack is already current, when there's no imagery built, or offline.
  useEffect(() => {
    if (!courseId) return;
    downloadPackInBackground(courseId, course?.name ?? null);
  }, [courseId, course?.name]);

  // Preselect a sensible middle tee once they load, so the picker is never
  // blank. Only while nothing has been chosen.
  useEffect(() => {
    if (selectedTeeId || tees.length === 0) return;
    setSelectedTeeId(defaultTee(tees).id);
  }, [tees, selectedTeeId]);

  // Default to the tee's own hole count where it's known — a 9-hole course
  // shouldn't open on "18".
  useEffect(() => {
    const holes = selectedTee?.number_of_holes;
    if (holes === 9) setHoleChoice('9');
  }, [selectedTee?.number_of_holes]);

  const onStart = async () => {
    if (!course) return;
    setError(null);
    try {
      const holesPlayed = holeChoice === '9' ? 9 : holeChoice === '18' ? 18 : customHoles;
      const isToday = roundDate === toLocalDateInput(new Date());
      await startRound.mutateAsync({
        course: {
          id: course.id,
          name: course.name,
          // A chosen tee set overrides the course-level tee / rating / yardage
          // and seeds the round's per-hole yardages.
          teeBox: selectedTee?.tee_name ?? course.tee_box,
          courseRating: selectedTee?.course_rating ?? course.course_rating,
          slopeRating: selectedTee?.slope_rating ?? course.slope_rating,
          totalPar: course.total_par ?? 72,
          totalYardage: selectedTee?.total_yards ?? course.total_yardage,
          teeId: selectedTee?.id ?? null,
          teeName: selectedTee?.tee_name ?? null,
          teeHoleYardages: selectedTee ? teeHoleYardages(selectedTee) : null
        },
        holesPlayed,
        // Today → null, so the round starts at the actual current time rather
        // than noon. A past day → the noon-anchored ISO, which can't drift to
        // the wrong calendar day in any timezone.
        playedAt: isToday ? null : localDateInputToIso(roundDate)
      });
      // Live rounds only: wake the watch onto the round. Backdated rounds are
      // historical data entry. Fire-and-forget either way.
      if (isToday) void watchBridge.launchWatch(false);
      navigate('/round/play', { replace: true });
    } catch (err) {
      setError(toAppError(err).message);
    }
  };

  if (courses.isLoading) {
    return (
      <Box>
        <PageHeader title="Round Setup" back />
        <Box sx={{ display: 'grid', placeItems: 'center', py: 8 }}>
          <CircularProgress />
        </Box>
      </Box>
    );
  }

  if (!course) {
    return (
      <Box>
        <PageHeader title="Round Setup" back="/round/start" backReplace />
        <Box px={2}>
          <Alert severity="warning" variant="outlined">
            That course isn't in your library any more. Pick another one.
          </Alert>
          <Button sx={{ mt: 2 }} onClick={() => navigate('/round/start', { replace: true })}>
            Back to courses
          </Button>
        </Box>
      </Box>
    );
  }

  const location = [course.city, course.state].filter(Boolean).join(', ');

  return (
    <Box>
      <PageHeader
        title={course.name}
        subtitle={location || 'Choose your tees and holes'}
        back="/round/start"
        backReplace
      />

      <Stack spacing={2} px={2} pb={4}>
        {error && <Alert severity="error">{error}</Alert>}

        <Card elevation={0} sx={{ bgcolor: 'background.paper', borderRadius: '5px' }}>
          <CardContent>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ textTransform: 'uppercase', letterSpacing: 0.5 }}
            >
              Tees
            </Typography>
            {teesQuery.isLoading ? (
              <Box sx={{ display: 'grid', placeItems: 'center', py: 3 }}>
                <CircularProgress size={22} />
              </Box>
            ) : tees.length === 0 ? (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
                No tee data for this course — the round will use its default
                rating and yardage. You can still record every shot.
              </Typography>
            ) : (
              <TeePicker tees={tees} value={selectedTeeId} onSelect={setSelectedTeeId} />
            )}
          </CardContent>
        </Card>

        <Card elevation={0} sx={{ bgcolor: 'background.paper', borderRadius: '5px' }}>
          <CardContent>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ textTransform: 'uppercase', letterSpacing: 0.5 }}
            >
              Holes
            </Typography>
            <Box mt={1.5}>
              <ToggleGroup
                value={holeChoice}
                onChange={(v) => v && setHoleChoice(v)}
                size="medium"
                options={[
                  { label: '9 holes', value: '9' },
                  { label: '18 holes', value: '18' },
                  { label: 'Custom', value: 'custom' }
                ]}
              />
            </Box>
            {holeChoice === 'custom' && (
              <TextField
                label="Number of holes"
                type="number"
                sx={{ mt: 2 }}
                value={customHoles}
                onChange={(e) =>
                  setCustomHoles(Math.max(1, Math.min(36, Number(e.target.value) || 1)))
                }
                inputProps={{ inputMode: 'numeric', min: 1, max: 36 }}
                fullWidth
              />
            )}
          </CardContent>
        </Card>

        <Card elevation={0} sx={{ bgcolor: 'background.paper', borderRadius: '5px' }}>
          <CardContent>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ textTransform: 'uppercase', letterSpacing: 0.5 }}
            >
              Date played
            </Typography>
            <TextField
              type="date"
              value={roundDate}
              onChange={(e) => setRoundDate(e.target.value)}
              fullWidth
              sx={{ mt: 1.5 }}
              inputProps={{ max: toLocalDateInput(new Date()) }}
              helperText="Leave as today to play now, or pick a past date to log a round you already played."
            />
          </CardContent>
        </Card>

        {/* Offline imagery: progress / saved / retry for the download the effect
            above already started. Also the only place a course can be saved for
            offline before it's ever played. Renders nothing when the course has
            no pack built. */}
        <Box sx={{ px: 0.5 }}>
          <CoursePackButton courseId={course.id} courseName={course.name} />
        </Box>

        <Button
          variant="contained"
          size="large"
          onClick={onStart}
          disabled={startRound.isPending}
          sx={{ minHeight: 64, fontSize: '1.1rem' }}
        >
          {startRound.isPending ? 'Starting…' : 'Start Round'}
        </Button>
      </Stack>
    </Box>
  );
}

function TeePicker({
  tees,
  value,
  onSelect
}: {
  tees: CourseTee[];
  value: string;
  onSelect: (id: string) => void;
}) {
  return (
    <Stack spacing={1} mt={1.5}>
      {tees.map((t) => {
        const isSelected = t.id === value;
        const meta = [
          t.total_yards ? `${t.total_yards.toLocaleString()} yds` : null,
          t.course_rating != null && t.slope_rating != null
            ? `${t.course_rating.toFixed(1)} / ${t.slope_rating}`
            : null,
          t.number_of_holes ? `${t.number_of_holes} holes` : null
        ]
          .filter(Boolean)
          .join('  ·  ');
        return (
          <Card
            key={t.id}
            elevation={0}
            sx={{
              bgcolor: 'background.default',
              border: 1,
              borderColor: isSelected ? 'primary.main' : 'divider',
              borderRadius: '5px'
            }}
          >
            <CardActionArea onClick={() => onSelect(t.id)} sx={{ minHeight: 52 }}>
              <CardContent sx={{ py: 1.25, '&:last-child': { pb: 1.25 } }}>
                <Stack direction="row" alignItems="center" spacing={0.75}>
                  <Typography variant="body1" sx={{ fontWeight: 600 }} noWrap>
                    {t.tee_name}
                  </Typography>
                  {t.gender && (
                    <Chip
                      size="small"
                      variant="outlined"
                      label={t.gender === 'female' ? "Women's" : "Men's"}
                      sx={{ height: 20, '.MuiChip-label': { px: 0.75, fontSize: '0.7rem' } }}
                    />
                  )}
                </Stack>
                {meta && (
                  <Typography variant="caption" color="text.secondary" display="block">
                    {meta}
                  </Typography>
                )}
              </CardContent>
            </CardActionArea>
          </Card>
        );
      })}
    </Stack>
  );
}

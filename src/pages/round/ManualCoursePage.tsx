import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Stack,
  TextField,
  Typography
} from '@mui/material';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { PageHeader } from '@/components/layout/PageHeader';
import { ToggleGroup } from '@/components/ui/ToggleGroup';
import { useStartRound } from '@/features/round/useStartRound';
import { toAppError } from '@/services/errors';
import { watchBridge } from '@/services/watchBridge';
import {
  integerOrNull,
  localDateInputToIso,
  numberOrNull,
  toLocalDateInput
} from '@/features/round/startRoundForm';

type HoleChoice = '9' | '18' | 'custom';

/**
 * Hand-entered course + round. The escape hatch from the picker for a course
 * that isn't in the library and isn't in GolfCourseAPI either.
 *
 * Unlike the picked-course path this is a single screen: a course typed in
 * here has no tee sets to choose from, so splitting it in two would just be an
 * extra tap. The course is created as part of starting the round, and appears
 * in the picker from then on.
 */
export function ManualCoursePage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const startRound = useStartRound();

  // Prefilled from whatever the golfer had typed in the picker's search box.
  const [courseName, setCourseName] = useState(params.get('name') ?? '');
  const [teeBox, setTeeBox] = useState('White');
  const [holeChoice, setHoleChoice] = useState<HoleChoice>('18');
  const [customHoles, setCustomHoles] = useState(9);
  const [courseRating, setCourseRating] = useState('72.0');
  const [slopeRating, setSlopeRating] = useState('113');
  const [totalPar, setTotalPar] = useState('72');
  const [totalYardage, setTotalYardage] = useState('6800');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [stateField, setStateField] = useState('');
  const [zip, setZip] = useState('');
  const [roundDate, setRoundDate] = useState(() => toLocalDateInput(new Date()));
  const [error, setError] = useState<string | null>(null);

  const onStart = async () => {
    setError(null);
    const name = courseName.trim();
    if (!name) {
      setError('Course name is required.');
      return;
    }
    try {
      const holesPlayed = holeChoice === '9' ? 9 : holeChoice === '18' ? 18 : customHoles;
      const isToday = roundDate === toLocalDateInput(new Date());
      await startRound.mutateAsync({
        course: {
          name,
          teeBox,
          courseRating: numberOrNull(courseRating),
          slopeRating: integerOrNull(slopeRating),
          totalPar: Math.max(1, Math.round(Number(totalPar)) || 72),
          totalYardage: integerOrNull(totalYardage),
          address: address.trim() || null,
          city: city.trim() || null,
          state: stateField.trim() || null,
          zip: zip.trim() || null
        },
        holesPlayed,
        playedAt: isToday ? null : localDateInputToIso(roundDate)
      });
      if (isToday) void watchBridge.launchWatch(false);
      navigate('/round/play', { replace: true });
    } catch (err) {
      setError(toAppError(err).message);
    }
  };

  return (
    <Box>
      <PageHeader
        title="Add Course"
        subtitle="Enter the details yourself"
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
              Course
            </Typography>
            <Stack spacing={2} mt={1.5}>
              <TextField
                label="Course Name"
                value={courseName}
                onChange={(e) => setCourseName(e.target.value)}
                required
                autoFocus
              />
              <TextField
                label="Tee Box"
                value={teeBox}
                onChange={(e) => setTeeBox(e.target.value)}
              />
            </Stack>
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
            <TextField
              type="date"
              label="Date played"
              value={roundDate}
              onChange={(e) => setRoundDate(e.target.value)}
              fullWidth
              sx={{ mt: 2 }}
              InputLabelProps={{ shrink: true }}
              inputProps={{ max: toLocalDateInput(new Date()) }}
            />
          </CardContent>
        </Card>

        <Card elevation={0} sx={{ bgcolor: 'background.paper', borderRadius: '5px' }}>
          <CardContent>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ textTransform: 'uppercase', letterSpacing: 0.5 }}
            >
              Course Info
            </Typography>
            <Stack direction="row" spacing={1.5} mt={2}>
              <TextField
                label="Course Rating"
                type="number"
                value={courseRating}
                onChange={(e) => setCourseRating(e.target.value)}
                inputProps={{ inputMode: 'decimal', step: '0.1' }}
              />
              <TextField
                label="Slope Rating"
                type="number"
                value={slopeRating}
                onChange={(e) => setSlopeRating(e.target.value)}
                inputProps={{ inputMode: 'numeric' }}
              />
            </Stack>
            <Stack direction="row" spacing={1.5} mt={2}>
              <TextField
                label="Total Par"
                type="number"
                value={totalPar}
                onChange={(e) => setTotalPar(e.target.value)}
                inputProps={{ inputMode: 'numeric' }}
              />
              <TextField
                label="Total Yardage"
                type="number"
                value={totalYardage}
                onChange={(e) => setTotalYardage(e.target.value)}
                inputProps={{ inputMode: 'numeric' }}
              />
            </Stack>
          </CardContent>
        </Card>

        <Card elevation={0} sx={{ bgcolor: 'background.paper', borderRadius: '5px' }}>
          <CardContent>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ textTransform: 'uppercase', letterSpacing: 0.5 }}
            >
              Location (optional)
            </Typography>
            <Stack spacing={1.5} mt={2}>
              <TextField
                label="Street Address"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                autoComplete="street-address"
              />
              <TextField
                label="City"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                autoComplete="address-level2"
              />
              <Stack direction="row" spacing={1.5}>
                <TextField
                  label="State"
                  value={stateField}
                  onChange={(e) => setStateField(e.target.value.toUpperCase())}
                  autoComplete="address-level1"
                  inputProps={{ maxLength: 20 }}
                  sx={{ flex: 1 }}
                />
                <TextField
                  label="ZIP"
                  value={zip}
                  onChange={(e) => setZip(e.target.value)}
                  autoComplete="postal-code"
                  inputProps={{ inputMode: 'numeric', maxLength: 12 }}
                  sx={{ flex: 1 }}
                />
              </Stack>
            </Stack>
          </CardContent>
        </Card>

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

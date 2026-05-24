import { useState } from 'react';
import {
  Box,
  Button,
  Card,
  CardContent,
  Stack,
  TextField,
  Typography,
  MenuItem,
  Alert
} from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '@/components/layout/PageHeader';
import { ToggleGroup } from '@/components/ui/ToggleGroup';
import { useCourses, useStartRound } from '@/features/round/useStartRound';
import { toAppError } from '@/services/errors';

type HoleChoice = '9' | '18' | 'custom';

export function StartRoundPage() {
  const navigate = useNavigate();
  const courses = useCourses();
  const startRound = useStartRound();

  const [mode, setMode] = useState<'existing' | 'manual'>('manual');
  const [selectedCourseId, setSelectedCourseId] = useState<string>('');
  const [courseName, setCourseName] = useState('');
  const [teeBox, setTeeBox] = useState('White');
  const [holeChoice, setHoleChoice] = useState<HoleChoice>('18');
  const [customHoles, setCustomHoles] = useState<number>(9);
  const [courseRating, setCourseRating] = useState<string>('72.0');
  const [slopeRating, setSlopeRating] = useState<string>('113');
  const [totalPar, setTotalPar] = useState<string>('72');
  const [totalYardage, setTotalYardage] = useState<string>('6800');
  const [address, setAddress] = useState<string>('');
  const [city, setCity] = useState<string>('');
  const [stateField, setStateField] = useState<string>('');
  const [zip, setZip] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  const onStart = async () => {
    setError(null);
    try {
      const holesPlayed = holeChoice === '9' ? 9 : holeChoice === '18' ? 18 : customHoles;
      const selected = courses.data?.find((c) => c.id === selectedCourseId);

      const payload = {
        course: mode === 'existing' && selected
          ? {
              id: selected.id,
              name: selected.name,
              teeBox: selected.tee_box,
              courseRating: selected.course_rating,
              slopeRating: selected.slope_rating,
              totalPar: selected.total_par ?? (Number(totalPar) || 72),
              totalYardage: selected.total_yardage
            }
          : {
              name: courseName.trim(),
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
        holesPlayed
      };

      if (!payload.course.name) {
        setError('Course name is required.');
        return;
      }

      await startRound.mutateAsync(payload);
      navigate('/round/play', { replace: true });
    } catch (err) {
      setError(toAppError(err).message);
    }
  };

  return (
    <Box>
      <PageHeader title="Start Round" subtitle="Set up the course and number of holes" back />
      <Stack spacing={2} px={2} pb={4}>
        {error && <Alert severity="error">{error}</Alert>}

        <Card elevation={0} sx={{ bgcolor: 'background.paper' }}>
          <CardContent>
            <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Course
            </Typography>
            <ToggleGroup
              value={mode}
              onChange={(v) => v && setMode(v)}
              size="medium"
              options={[
                { label: 'Existing course', value: 'existing' },
                { label: 'Manual entry', value: 'manual' }
              ]}
            />
            {mode === 'existing' ? (
              <TextField
                select
                label="Select course"
                sx={{ mt: 2 }}
                value={selectedCourseId}
                onChange={(e) => setSelectedCourseId(e.target.value)}
              >
                {(courses.data ?? []).length === 0 ? (
                  <MenuItem disabled value="">
                    No courses yet — switch to Manual entry
                  </MenuItem>
                ) : (
                  (courses.data ?? []).map((c) => {
                    const place = [c.city, c.state].filter(Boolean).join(', ');
                    return (
                      <MenuItem key={c.id} value={c.id}>
                        {c.name}
                        {c.tee_box ? ` · ${c.tee_box}` : ''}
                        {place ? ` · ${place}` : ''}
                      </MenuItem>
                    );
                  })
                )}
              </TextField>
            ) : (
              <Stack spacing={2} mt={2}>
                <TextField
                  label="Course Name"
                  value={courseName}
                  onChange={(e) => setCourseName(e.target.value)}
                  required
                />
                <TextField label="Tee Box" value={teeBox} onChange={(e) => setTeeBox(e.target.value)} />
              </Stack>
            )}
          </CardContent>
        </Card>

        <Card elevation={0} sx={{ bgcolor: 'background.paper' }}>
          <CardContent>
            <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Holes
            </Typography>
            <Box mt={1}>
              <ToggleGroup
                value={holeChoice}
                onChange={(v) => v && setHoleChoice(v)}
                options={[
                  { label: '9', value: '9' },
                  { label: '18', value: '18' },
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
                onChange={(e) => setCustomHoles(Math.max(1, Math.min(36, Number(e.target.value) || 1)))}
                inputProps={{ inputMode: 'numeric', min: 1, max: 36 }}
              />
            )}
          </CardContent>
        </Card>

        {mode === 'manual' && (
          <>
            <Card elevation={0} sx={{ bgcolor: 'background.paper' }}>
              <CardContent>
                <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 0.5 }}>
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

            <Card elevation={0} sx={{ bgcolor: 'background.paper' }}>
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
          </>
        )}

        <Button
          variant="contained"
          size="large"
          onClick={onStart}
          disabled={startRound.isPending || (mode === 'existing' && !selectedCourseId)}
          sx={{ minHeight: 64, fontSize: '1.1rem' }}
        >
          {startRound.isPending ? 'Starting…' : 'Create Round'}
        </Button>
      </Stack>
    </Box>
  );
}

function numberOrNull(s: string): number | null {
  if (s.trim() === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function integerOrNull(s: string): number | null {
  if (s.trim() === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n) : null;
}

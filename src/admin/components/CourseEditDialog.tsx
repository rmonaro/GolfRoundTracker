import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography
} from '@mui/material';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Course, CourseOsmStatus } from '@/models';
import { adminCoursesRepo } from '@/services/adminCoursesRepo';

interface CourseEditDialogProps {
  open: boolean;
  course: Course;
  onClose: () => void;
}

const STATUS_OPTIONS: CourseOsmStatus[] = [
  'pending',
  'synced',
  'no_coverage',
  'failed',
  'skip'
];

/**
 * Admin-only metadata editor — the fields here are exactly what the OSM sync
 * function needs to do its work (lat/lng + search_radius), plus the small set
 * of display fields commonly missing on user-added courses (club_name,
 * country). When the admin enters lat/lng on a course currently flagged as
 * `skip`, we auto-flip osm_status → `pending` so the next Resync OSM picks
 * it up.
 */
export function CourseEditDialog({ open, course, onClose }: CourseEditDialogProps) {
  const queryClient = useQueryClient();

  // String form state — number inputs keep the raw text so the user can
  // backspace through a decimal cleanly. Conversion happens on submit.
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [searchRadius, setSearchRadius] = useState('');
  const [clubName, setClubName] = useState('');
  const [country, setCountry] = useState('');
  const [osmStatus, setOsmStatus] = useState<CourseOsmStatus>('pending');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [stateField, setStateField] = useState('');
  const [zip, setZip] = useState('');
  const [autoFlipped, setAutoFlipped] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLat(course.lat != null ? String(course.lat) : '');
    setLng(course.lng != null ? String(course.lng) : '');
    setSearchRadius(course.search_radius != null ? String(course.search_radius) : '');
    setClubName(course.club_name ?? '');
    setCountry(course.country ?? '');
    setOsmStatus((course.osm_status ?? 'pending') as CourseOsmStatus);
    setAddress(course.address ?? '');
    setCity(course.city ?? '');
    setStateField(course.state ?? '');
    setZip(course.zip ?? '');
    setAutoFlipped(false);
  }, [open, course]);

  // If admin is filling lat/lng on a skip course, suggest flipping to pending.
  // Stop suggesting after admin manually picks a status (autoFlipped tracks it).
  useEffect(() => {
    if (autoFlipped) return;
    if (!open) return;
    if (course.osm_status === 'skip' && lat.trim() !== '' && lng.trim() !== '') {
      setOsmStatus('pending');
    }
  }, [lat, lng, course.osm_status, open, autoFlipped]);

  const mutation = useMutation({
    mutationFn: () =>
      adminCoursesRepo.updateMetadata(course.id, {
        lat: parseFloatOrNull(lat),
        lng: parseFloatOrNull(lng),
        search_radius: parseIntOrNull(searchRadius),
        club_name: blankToNull(clubName),
        country: blankToNull(country),
        osm_status: osmStatus,
        address: blankToNull(address),
        city: blankToNull(city),
        state: blankToNull(stateField),
        zip: blankToNull(zip)
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-course', course.id] });
      queryClient.invalidateQueries({ queryKey: ['admin-all-courses'] });
      queryClient.invalidateQueries({ queryKey: ['admin-stats'] });
      onClose();
    }
  });

  const latNum = parseFloatOrNull(lat);
  const lngNum = parseFloatOrNull(lng);
  const latValid = latNum == null || (latNum >= -90 && latNum <= 90);
  const lngValid = lngNum == null || (lngNum >= -180 && lngNum <= 180);
  const radiusNum = parseIntOrNull(searchRadius);
  const radiusValid = radiusNum == null || (radiusNum >= 50 && radiusNum <= 5000);
  const canSubmit = latValid && lngValid && radiusValid && !mutation.isPending;

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Edit course</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Typography variant="caption" color="text.secondary">
            Lat/lng + radius are what the OSM sync needs. Find coords by searching
            the course on Google Maps and copying from the URL, or via the "Open in
            OSM" link on this page once coords are saved.
          </Typography>

          <Stack direction="row" spacing={1.5}>
            <TextField
              label="Latitude"
              value={lat}
              onChange={(e) => setLat(e.target.value)}
              error={!latValid}
              helperText={latValid ? ' ' : 'Must be between -90 and 90'}
              inputProps={{ inputMode: 'decimal' }}
              fullWidth
            />
            <TextField
              label="Longitude"
              value={lng}
              onChange={(e) => setLng(e.target.value)}
              error={!lngValid}
              helperText={lngValid ? ' ' : 'Must be between -180 and 180'}
              inputProps={{ inputMode: 'decimal' }}
              fullWidth
            />
          </Stack>

          <TextField
            label="Search radius (meters)"
            value={searchRadius}
            onChange={(e) => setSearchRadius(e.target.value)}
            placeholder="1500 (default)"
            error={!radiusValid}
            helperText={radiusValid ? ' ' : 'Must be between 50 and 5000'}
            inputProps={{ inputMode: 'numeric' }}
          />

          <TextField
            label="Club name (optional)"
            value={clubName}
            onChange={(e) => setClubName(e.target.value)}
          />

          <TextField
            label="Street address (optional)"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            autoComplete="street-address"
          />
          <TextField
            label="City (optional)"
            value={city}
            onChange={(e) => setCity(e.target.value)}
            autoComplete="address-level2"
          />
          <Stack direction="row" spacing={1.5}>
            <TextField
              label="State (optional)"
              value={stateField}
              onChange={(e) => setStateField(e.target.value.toUpperCase())}
              autoComplete="address-level1"
              inputProps={{ maxLength: 20 }}
              sx={{ flex: 1 }}
            />
            <TextField
              label="ZIP (optional)"
              value={zip}
              onChange={(e) => setZip(e.target.value)}
              autoComplete="postal-code"
              inputProps={{ inputMode: 'numeric', maxLength: 12 }}
              sx={{ flex: 1 }}
            />
          </Stack>
          <TextField
            label="Country (optional)"
            value={country}
            onChange={(e) => setCountry(e.target.value)}
          />

          <FormControl>
            <InputLabel>OSM status</InputLabel>
            <Select
              label="OSM status"
              value={osmStatus}
              onChange={(e) => {
                setOsmStatus(e.target.value as CourseOsmStatus);
                setAutoFlipped(true);
              }}
            >
              {STATUS_OPTIONS.map((s) => (
                <MenuItem key={s} value={s}>
                  {s}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          {course.osm_status === 'skip' &&
            osmStatus === 'pending' &&
            latNum != null &&
            lngNum != null && (
              <Alert severity="info">
                Status flipped to <strong>pending</strong> — the next Resync OSM will
                attempt to fetch geometry for this course.
              </Alert>
            )}

          {mutation.error && (
            <Alert severity="error">{(mutation.error as Error).message}</Alert>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={mutation.isPending}>
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={() => mutation.mutate()}
          disabled={!canSubmit}
        >
          {mutation.isPending ? 'Saving…' : 'Save'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function parseFloatOrNull(s: string): number | null {
  const trimmed = s.trim();
  if (trimmed === '') return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

function parseIntOrNull(s: string): number | null {
  const trimmed = s.trim();
  if (trimmed === '') return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? Math.round(n) : null;
}

function blankToNull(s: string): string | null {
  const t = s.trim();
  return t === '' ? null : t;
}


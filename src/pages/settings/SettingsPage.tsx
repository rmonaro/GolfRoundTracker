import { useState, useEffect } from 'react';
import {
  Box,
  Button,
  Card,
  CardContent,
  Divider,
  FormControlLabel,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Typography
} from '@mui/material';
import LogoutRoundedIcon from '@mui/icons-material/LogoutRounded';
import WatchRoundedIcon from '@mui/icons-material/WatchRounded';
import AdminPanelSettingsRoundedIcon from '@mui/icons-material/AdminPanelSettingsRounded';
import { useIsAdmin } from '@/admin/hooks/useIsAdmin';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '@/components/layout/PageHeader';
import { useAuthStore } from '@/stores/authStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { authService } from '@/services/authService';
import { profileRepo } from '@/services/profileRepo';
import { toAppError } from '@/services/errors';
import type { DominantHand } from '@/models';

export function SettingsPage() {
  const navigate = useNavigate();
  const profile = useAuthStore((s) => s.profile);
  const setProfile = useAuthStore((s) => s.setProfile);
  const reset = useAuthStore((s) => s.reset);
  const themeMode = useSettingsStore((s) => s.themeMode);
  const toggleTheme = useSettingsStore((s) => s.toggleTheme);
  const watchModeEnabled = useSettingsStore((s) => s.watchModeEnabled);
  const setWatchMode = useSettingsStore((s) => s.setWatchMode);
  const gpsEnabled = useSettingsStore((s) => s.gpsEnabled);
  const setGpsEnabled = useSettingsStore((s) => s.setGpsEnabled);
  const { data: isAdmin } = useIsAdmin();

  const [firstName, setFirstName] = useState(profile?.first_name ?? '');
  const [lastName, setLastName] = useState(profile?.last_name ?? '');
  const [handicapGoal, setHandicapGoal] = useState<string>(
    profile?.handicap_goal != null ? String(profile.handicap_goal) : ''
  );
  const [dominantHand, setDominantHand] = useState<DominantHand | ''>(profile?.dominant_hand ?? '');
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (profile) {
      setFirstName(profile.first_name ?? '');
      setLastName(profile.last_name ?? '');
      setHandicapGoal(profile.handicap_goal != null ? String(profile.handicap_goal) : '');
      setDominantHand(profile.dominant_hand ?? '');
    }
  }, [profile]);

  const onSave = async () => {
    if (!profile) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await profileRepo.update(profile.id, {
        first_name: firstName.trim() || null,
        last_name: lastName.trim() || null,
        handicap_goal: handicapGoal ? Number(handicapGoal) : null,
        dominant_hand: dominantHand || null
      });
      setProfile(updated);
      setSavedAt(Date.now());
    } catch (err) {
      setError(toAppError(err).message);
    } finally {
      setSaving(false);
    }
  };

  const onSignOut = async () => {
    try {
      await authService.signOut();
      reset();
      navigate('/auth/login', { replace: true });
    } catch (err) {
      setError(toAppError(err).message);
    }
  };

  return (
    <Box>
      <PageHeader title="Settings" />
      <Stack spacing={2} px={2} pb={4}>
        <Card elevation={0} sx={{ bgcolor: 'background.paper' }}>
          <CardContent>
            <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 0.6 }}>
              Profile
            </Typography>
            <Stack spacing={1.5} mt={1}>
              <Stack direction="row" spacing={1.5}>
                <TextField label="First name" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
                <TextField label="Last name" value={lastName} onChange={(e) => setLastName(e.target.value)} />
              </Stack>
              <TextField label="Email" value={profile?.email ?? ''} disabled />
              <Stack direction="row" spacing={1.5}>
                <TextField
                  label="Handicap goal"
                  type="number"
                  value={handicapGoal}
                  onChange={(e) => setHandicapGoal(e.target.value)}
                  inputProps={{ inputMode: 'decimal', step: '0.1' }}
                />
                <TextField
                  select
                  label="Dominant hand"
                  value={dominantHand}
                  onChange={(e) => setDominantHand(e.target.value as DominantHand | '')}
                >
                  <MenuItem value="">—</MenuItem>
                  <MenuItem value="right">Right</MenuItem>
                  <MenuItem value="left">Left</MenuItem>
                </TextField>
              </Stack>
              <Button variant="contained" onClick={onSave} disabled={saving}>
                {saving ? 'Saving…' : savedAt ? 'Saved' : 'Save'}
              </Button>
              {error && (
                <Typography variant="body2" color="error">
                  {error}
                </Typography>
              )}
            </Stack>
          </CardContent>
        </Card>

        <Card elevation={0} sx={{ bgcolor: 'background.paper' }}>
          <CardContent>
            <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 0.6 }}>
              Appearance
            </Typography>
            <Stack mt={1} spacing={1}>
              <FormControlLabel
                control={<Switch checked={themeMode === 'dark'} onChange={toggleTheme} />}
                label={themeMode === 'dark' ? 'Dark mode' : 'Light mode'}
              />
            </Stack>
          </CardContent>
        </Card>

        <Card elevation={0} sx={{ bgcolor: 'background.paper' }}>
          <CardContent>
            <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 0.6 }}>
              Companion
            </Typography>
            <Stack mt={1} spacing={1}>
              <FormControlLabel
                control={<Switch checked={watchModeEnabled} onChange={(e) => setWatchMode(e.target.checked)} />}
                label="Enable watch UI preview"
              />
              <Button
                startIcon={<WatchRoundedIcon />}
                variant="outlined"
                onClick={() => navigate('/watch')}
                disabled={!watchModeEnabled}
              >
                Open Watch Preview
              </Button>
            </Stack>
          </CardContent>
        </Card>

        <Card elevation={0} sx={{ bgcolor: 'background.paper' }}>
          <CardContent>
            <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 0.6 }}>
              GPS
            </Typography>
            <Stack mt={1} spacing={0.5}>
              <FormControlLabel
                control={<Switch checked={gpsEnabled} onChange={(e) => setGpsEnabled(e.target.checked)} />}
                label="Enable GPS tracking"
              />
              <Typography variant="caption" color="text.secondary">
                Powers the Track button on the hole screen and the at-course
                indicator. Off by default — flip on to be prompted for location
                next time you open a hole.
              </Typography>
            </Stack>
          </CardContent>
        </Card>

        {isAdmin && (
          <Card elevation={0} sx={{ bgcolor: 'background.paper' }}>
            <CardContent>
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ textTransform: 'uppercase', letterSpacing: 0.6 }}
              >
                Admin
              </Typography>
              <Stack mt={1}>
                <Button
                  startIcon={<AdminPanelSettingsRoundedIcon />}
                  variant="outlined"
                  onClick={() => navigate('/admin')}
                  sx={{ minHeight: 56 }}
                >
                  Open Admin Panel
                </Button>
              </Stack>
            </CardContent>
          </Card>
        )}

        <Divider />

        <Button
          variant="text"
          color="error"
          startIcon={<LogoutRoundedIcon />}
          onClick={onSignOut}
          sx={{ minHeight: 56 }}
        >
          Log Out
        </Button>

        <Typography variant="caption" color="text.secondary" align="center">
          Estimated handicap only. Not an official USGA handicap.
        </Typography>
      </Stack>
    </Box>
  );
}

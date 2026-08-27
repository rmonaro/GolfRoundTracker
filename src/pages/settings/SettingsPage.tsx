import { useState, useEffect } from 'react';
import {
  BottomNavigation,
  BottomNavigationAction,
  Box,
  Button,
  Card,
  CardContent,
  Divider,
  FormControlLabel,
  MenuItem,
  Paper,
  Stack,
  Switch,
  TextField,
  Typography
} from '@mui/material';
import PersonRoundedIcon from '@mui/icons-material/PersonRounded';
import TuneRoundedIcon from '@mui/icons-material/TuneRounded';
import CloudDownloadRoundedIcon from '@mui/icons-material/CloudDownloadRounded';
import LogoutRoundedIcon from '@mui/icons-material/LogoutRounded';
import WatchRoundedIcon from '@mui/icons-material/WatchRounded';
import AdminPanelSettingsRoundedIcon from '@mui/icons-material/AdminPanelSettingsRounded';
import { useIsAdmin } from '@/admin/hooks/useIsAdmin';
import { useAppModeStore, homePathFor } from '@/stores/appModeStore';
import { useConnectivity } from '@/features/offline/useConnectivity';
import { OfflineCoursesCard } from '@/features/offline/OfflineCoursesCard';
import { isSimulatedOffline, setSimulatedOffline } from '@/services/connectivity';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '@/components/layout/PageHeader';
import { bottomNavSx } from '@/components/layout/bottomNavStyles';
import { watchName } from '@/utils/platform';
import { useAuthStore } from '@/stores/authStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { authService } from '@/services/authService';
import { profileRepo } from '@/services/profileRepo';
import { toAppError } from '@/services/errors';
import type { DominantHand, SkillLevel, Gender } from '@/models';

const skillLevelOptions = (
  gender: Gender | ''
): { value: SkillLevel; label: string; helper: string }[] => [
  { value: 'beginner', label: 'Beginner', helper: 'New to golf or shoots 100+' },
  { value: 'average', label: 'Average', helper: 'Typically shoots 90–100' },
  { value: 'good', label: 'Good', helper: 'Typically shoots 80–90' },
  { value: 'advanced', label: 'Advanced', helper: 'Single-digit handicap' },
  {
    value: 'pga_tour',
    label: gender === 'female' ? 'LPGA Tour' : 'PGA Tour',
    helper: 'Scratch / professional'
  }
];

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
  const watchShotDetectionEnabled = useSettingsStore((s) => s.watchShotDetectionEnabled);
  const setWatchShotDetection = useSettingsStore((s) => s.setWatchShotDetection);
  const { data: isAdmin } = useIsAdmin();
  const appMode = useAppModeStore((s) => s.mode);
  const connectivity = useConnectivity();
  const [simulateOffline, setSimulateOffline] = useState(isSimulatedOffline);
  const [tab, setTab] = useState<'profile' | 'settings' | 'courses'>('profile');

  const [firstName, setFirstName] = useState(profile?.first_name ?? '');
  const [lastName, setLastName] = useState(profile?.last_name ?? '');
  const [handicapGoal, setHandicapGoal] = useState<string>(
    profile?.handicap_goal != null ? String(profile.handicap_goal) : ''
  );
  const [dominantHand, setDominantHand] = useState<DominantHand | ''>(profile?.dominant_hand ?? '');
  const [skillLevel, setSkillLevel] = useState<SkillLevel | ''>(profile?.skill_level ?? '');
  const [gender, setGender] = useState<Gender | ''>(profile?.gender ?? '');
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (profile) {
      setFirstName(profile.first_name ?? '');
      setLastName(profile.last_name ?? '');
      setHandicapGoal(profile.handicap_goal != null ? String(profile.handicap_goal) : '');
      setDominantHand(profile.dominant_hand ?? '');
      setSkillLevel(profile.skill_level ?? '');
      setGender(profile.gender ?? '');
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
        dominant_hand: dominantHand || null,
        skill_level: skillLevel || null,
        gender: gender || null
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
      {/* `back` takes an explicit path rather than navigate(-1): Settings is
          reachable from the bottom nav on any tab, so history could send the
          user somewhere unrelated. The current side's home is always right. */}
      <PageHeader title="Settings" back={appMode ? homePathFor(appMode) : '/'} />

      <Stack
        spacing={2}
        px={2}
        pt={2}
        pb={4}
        sx={{
          // Unify input + button corners with the cards on this page.
          // Targets every MUI TextField (outlined input root) and every
          // Button rendered anywhere inside the settings stack.
          '& .MuiOutlinedInput-root': { borderRadius: '5px' },
          '& .MuiButtonBase-root.MuiButton-root': { borderRadius: '5px' }
        }}
      >
        {tab === 'profile' && (
        <>
        <Card elevation={0} sx={{ bgcolor: 'background.paper', borderRadius: '5px' }}>
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
              <TextField
                select
                fullWidth
                label="Gender"
                value={gender}
                onChange={(e) => setGender(e.target.value as Gender | '')}
                helperText="Used to pick the right yardage reference table for your bag."
              >
                <MenuItem value="">—</MenuItem>
                <MenuItem value="male">Male</MenuItem>
                <MenuItem value="female">Female</MenuItem>
              </TextField>
              <TextField
                select
                fullWidth
                label="Skill level"
                value={skillLevel}
                onChange={(e) => setSkillLevel(e.target.value as SkillLevel | '')}
                helperText={
                  skillLevelOptions(gender).find((o) => o.value === skillLevel)?.helper ??
                  'Used to tailor recommendations and expected stats.'
                }
              >
                <MenuItem value="">—</MenuItem>
                {skillLevelOptions(gender).map((opt) => (
                  <MenuItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </MenuItem>
                ))}
              </TextField>
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

        <Divider />

        {/* Account-level action, so it sits with the account details rather
            than among the app preferences. */}
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
        </>
        )}

        {tab === 'settings' && (
        <>
        <Card elevation={0} sx={{ bgcolor: 'background.paper', borderRadius: '5px' }}>
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

        {isAdmin && (
          <Card elevation={0} sx={{ bgcolor: 'background.paper', borderRadius: '5px' }}>
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
        )}

        <Card elevation={0} sx={{ bgcolor: 'background.paper', borderRadius: '5px' }}>
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

        <Card elevation={0} sx={{ bgcolor: 'background.paper', borderRadius: '5px' }}>
          <CardContent>
            <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 0.6 }}>
              {watchName({ title: true })}
            </Typography>
            <Stack mt={1} spacing={0.5}>
              <FormControlLabel
                control={
                  <Switch
                    checked={watchShotDetectionEnabled}
                    onChange={(e) => setWatchShotDetection(e.target.checked)}
                  />
                }
                label="Shot detection"
              />
              <Typography variant="caption" color="text.secondary">
                Uses your {watchName()} to detect real club strikes so auto-track
                only logs a shot when you actually hit — not when you walk to
                the cart. Needs the watch worn and GPS tracking on. Runs a
                workout session during the round, which uses extra watch
                battery.
              </Typography>
            </Stack>
          </CardContent>
        </Card>

        {/* ADMIN ONLY. It must stay reachable on a real device — Capacitor
            serves the production bundle, so a DEV-only gate would hide this
            exactly where offline behaviour needs testing: on-course, on the
            phone, with the app killed and relaunched. Trade-off: a developer
            running locally without an admin account no longer sees this, and
            has to clear a stuck flag via `window.__grtClearOffline()`. */}
        {isAdmin && (
          <Card elevation={0} sx={{ bgcolor: 'background.paper', borderRadius: '5px' }}>
            <CardContent>
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ textTransform: 'uppercase', letterSpacing: 0.6 }}
              >
                Developer
              </Typography>
              <Stack mt={1} spacing={0.5}>
                <FormControlLabel
                  control={
                    <Switch
                      checked={simulateOffline}
                      onChange={(e) => {
                        setSimulatedOffline(e.target.checked);
                        setSimulateOffline(e.target.checked);
                      }}
                    />
                  }
                  label="Simulate offline"
                />
                {simulateOffline ? (
                  // This setting persists across relaunches by design (you need
                  // it to survive an app kill mid-round), so it has to be loud —
                  // otherwise it reads as a broken app days later.
                  <Typography variant="caption" sx={{ color: 'warning.main', fontWeight: 700 }}>
                    Simulated offline is ON. The app will behave as if it has no
                    signal until you turn this off, including after a restart.
                  </Typography>
                ) : (
                  <Typography variant="caption" color="text.secondary">
                    Forces the app to behave as if there's no signal, for testing
                    offline play.
                  </Typography>
                )}
                <Typography variant="caption" color="text.secondary">
                  Network state: <strong>{connectivity.status}</strong>
                  {connectivity.connectionType !== 'unknown' &&
                    ` (${connectivity.connectionType})`}
                  .
                </Typography>
              </Stack>
            </CardContent>
          </Card>
        )}

        {isAdmin && (
          <Card elevation={0} sx={{ bgcolor: 'background.paper', borderRadius: '5px' }}>
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
        </>
        )}

        {tab === 'courses' && <OfflineCoursesCard />}
      </Stack>

      {/* Section switcher, rendered IN PLACE OF the app's bottom nav —
          `MobileShell` hides its own nav for /settings (see `ownsBottomBar`)
          so these two never stack. Styling deliberately mirrors the nav it
          replaces — same Paper surface, same row geometry (shared
          `bottomNavSx`), same safe-area padding — so switching sections feels
          like the nav rather than a second bar. */}
      <Paper
        elevation={8}
        sx={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          borderTop: 1,
          borderColor: 'divider',
          bgcolor: 'background.paper',
          paddingBottom: 'env(safe-area-inset-bottom)',
          zIndex: 10
        }}
      >
        <BottomNavigation
          value={tab}
          // Admin is a LINK, not a section — selecting it would leave the bar
          // highlighting a panel that renders nothing. Navigate away instead
          // and leave `tab` untouched, so coming back lands where you left.
          onChange={(_, v) => (v === 'admin' ? navigate('/admin') : setTab(v))}
          showLabels
          sx={bottomNavSx}
        >
          <BottomNavigationAction
            value="profile"
            label="Profile"
            icon={<PersonRoundedIcon />}
          />
          <BottomNavigationAction
            value="settings"
            label="Settings"
            icon={<TuneRoundedIcon />}
          />
          <BottomNavigationAction
            value="courses"
            label="Courses"
            icon={<CloudDownloadRoundedIcon />}
          />
          {/* BottomNavigation skips non-element children, so `false` is safe. */}
          {isAdmin && (
            <BottomNavigationAction
              value="admin"
              label="Admin"
              icon={<AdminPanelSettingsRoundedIcon />}
            />
          )}
        </BottomNavigation>
      </Paper>
    </Box>
  );
}

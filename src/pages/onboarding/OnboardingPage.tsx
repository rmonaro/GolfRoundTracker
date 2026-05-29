import { useState } from 'react';
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  MenuItem,
  Stack,
  Stepper,
  Step,
  StepLabel,
  TextField,
  Typography
} from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { profileRepo } from '@/services/profileRepo';
import { bagRepo } from '@/services/bagRepo';
import { toAppError } from '@/services/errors';
import { CATEGORY_LABELS, DEFAULT_BAG } from '@/features/bag/defaultClubs';
import { getDefaultYardageByName } from '@/features/bag/clubYardageDefaults';
import type { ClubCategory, Gender, SkillLevel } from '@/models';

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

const STEPS = ['About you', 'Woods', 'Irons & wedges'] as const;

const LONG_CATEGORIES: ClubCategory[] = ['driver', 'wood', 'hybrid'];
const SHORT_CATEGORIES: ClubCategory[] = ['iron', 'wedge', 'putter'];

function clubsForCategories(categories: ClubCategory[]) {
  return categories.map((cat) => ({
    category: cat,
    clubs: DEFAULT_BAG.filter((c) => c.category === cat)
  }));
}

export function OnboardingPage() {
  const navigate = useNavigate();
  const profile = useAuthStore((s) => s.profile);
  const setProfile = useAuthStore((s) => s.setProfile);

  const [step, setStep] = useState(0);
  const [gender, setGender] = useState<Gender | ''>(profile?.gender ?? '');
  const [skillLevel, setSkillLevel] = useState<SkillLevel | ''>(profile?.skill_level ?? '');
  // Empty by default — user opts in to the clubs they actually carry.
  const [selectedClubs, setSelectedClubs] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const step1Valid = gender !== '' && skillLevel !== '';
  const totalSelected = selectedClubs.size;
  // The final step requires at least one club total across both bag screens.
  const canFinish = totalSelected > 0;

  const toggleClub = (name: string) => {
    setSelectedClubs((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const finish = async () => {
    if (!profile || !step1Valid || !canFinish) return;
    setSubmitting(true);
    setError(null);
    try {
      const updated = await profileRepo.update(profile.id, {
        gender: gender as Gender,
        skill_level: skillLevel as SkillLevel,
        onboarded_at: new Date().toISOString()
      });
      setProfile(updated);

      const picks = DEFAULT_BAG.filter((c) => selectedClubs.has(c.name));
      let position = 0;
      for (const { name, category } of picks) {
        const club = await bagRepo.createClub(name, category);
        await bagRepo.addToBag(profile.id, club.id, position, {
          typicalDistanceYards: getDefaultYardageByName(
            skillLevel as SkillLevel,
            gender as Gender,
            name,
            category
          )
        });
        position++;
      }

      navigate('/', { replace: true });
    } catch (err) {
      setError(toAppError(err).message);
      setSubmitting(false);
    }
  };

  return (
    <Box
      sx={{
        minHeight: '100dvh',
        bgcolor: 'background.default',
        display: 'flex',
        justifyContent: 'center',
        py: { xs: 2, sm: 4 },
        px: 2
      }}
    >
      <Box sx={{ width: '100%', maxWidth: 560 }}>
        <Stack spacing={1} mb={3}>
          <Typography variant="h5" sx={{ fontWeight: 700 }}>
            Welcome{profile?.first_name ? `, ${profile.first_name}` : ''} 👋
          </Typography>
          <Typography variant="body2" color="text.secondary">
            A couple of quick questions so the app can suggest the right yardages
            before your first round.
          </Typography>
        </Stack>

        <Stepper activeStep={step} sx={{ mb: 3 }}>
          {STEPS.map((label) => (
            <Step key={label}>
              <StepLabel>{label}</StepLabel>
            </Step>
          ))}
        </Stepper>

        {step === 0 && (
          <Card elevation={0} sx={{ bgcolor: 'background.paper' }}>
            <CardContent>
              <Stack spacing={2}>
                <TextField
                  select
                  fullWidth
                  required
                  label="Gender"
                  value={gender}
                  onChange={(e) => setGender(e.target.value as Gender | '')}
                  helperText="Picks the right yardage reference table for your bag."
                >
                  <MenuItem value="">—</MenuItem>
                  <MenuItem value="male">Male</MenuItem>
                  <MenuItem value="female">Female</MenuItem>
                </TextField>

                <TextField
                  select
                  fullWidth
                  required
                  label="Skill level"
                  value={skillLevel}
                  onChange={(e) => setSkillLevel(e.target.value as SkillLevel | '')}
                  helperText={
                    skillLevelOptions(gender).find((o) => o.value === skillLevel)?.helper ??
                    'How would you describe your game today?'
                  }
                >
                  <MenuItem value="">—</MenuItem>
                  {skillLevelOptions(gender).map((opt) => (
                    <MenuItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </MenuItem>
                  ))}
                </TextField>

                <Button
                  variant="contained"
                  size="large"
                  disabled={!step1Valid}
                  onClick={() => setStep(1)}
                  sx={{ minHeight: 52 }}
                >
                  Continue
                </Button>
              </Stack>
            </CardContent>
          </Card>
        )}

        {step === 1 && (
          <ClubPickerStep
            heading="Which woods & hybrids do you carry?"
            groups={clubsForCategories(LONG_CATEGORIES)}
            selectedClubs={selectedClubs}
            onToggle={toggleClub}
            totalSelected={totalSelected}
            primaryLabel="Continue"
            primaryDisabled={false}
            onPrimary={() => setStep(2)}
            onBack={() => setStep(0)}
            submitting={submitting}
          />
        )}

        {step === 2 && (
          <ClubPickerStep
            heading="Which irons, wedges & putter do you carry?"
            groups={clubsForCategories(SHORT_CATEGORIES)}
            selectedClubs={selectedClubs}
            onToggle={toggleClub}
            totalSelected={totalSelected}
            primaryLabel={submitting ? 'Setting up…' : 'Finish'}
            primaryDisabled={!canFinish}
            primaryIcon={submitting ? <CircularProgress size={18} color="inherit" /> : null}
            onPrimary={finish}
            onBack={() => setStep(1)}
            submitting={submitting}
            error={error}
          />
        )}
      </Box>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Shared chip-picker step — used for both Woods and Irons screens.
// ---------------------------------------------------------------------------

interface ClubPickerStepProps {
  heading: string;
  groups: { category: ClubCategory; clubs: typeof DEFAULT_BAG }[];
  selectedClubs: Set<string>;
  onToggle: (name: string) => void;
  totalSelected: number;
  primaryLabel: string;
  primaryDisabled: boolean;
  primaryIcon?: React.ReactNode;
  onPrimary: () => void;
  onBack: () => void;
  submitting: boolean;
  error?: string | null;
}

function ClubPickerStep({
  heading,
  groups,
  selectedClubs,
  onToggle,
  totalSelected,
  primaryLabel,
  primaryDisabled,
  primaryIcon,
  onPrimary,
  onBack,
  submitting,
  error
}: ClubPickerStepProps) {
  return (
    <Card elevation={0} sx={{ bgcolor: 'background.paper' }}>
      <CardContent>
        <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 0.5 }}>
          {heading}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Tap each club you carry. We'll prefill the yardages from your skill
          level — you can fine-tune them later in your bag.
        </Typography>

        <Stack spacing={1.5}>
          {groups.map(({ category, clubs }) => (
            <Box key={category}>
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ textTransform: 'uppercase', letterSpacing: 0.6 }}
              >
                {CATEGORY_LABELS[category]}
              </Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, mt: 0.5 }}>
                {clubs.map((c) => {
                  const isSelected = selectedClubs.has(c.name);
                  return (
                    <Chip
                      key={c.name}
                      label={c.name}
                      onClick={() => onToggle(c.name)}
                      color={isSelected ? 'primary' : 'default'}
                      variant={isSelected ? 'filled' : 'outlined'}
                      sx={{ fontWeight: 600, minHeight: 36 }}
                    />
                  );
                })}
              </Box>
            </Box>
          ))}

          <Typography variant="caption" color="text.secondary" sx={{ mt: 1 }}>
            {totalSelected} {totalSelected === 1 ? 'club' : 'clubs'} selected so far
          </Typography>

          {error && (
            <Typography variant="body2" color="error">
              {error}
            </Typography>
          )}

          <Stack direction="row" spacing={1}>
            <Button variant="text" onClick={onBack} disabled={submitting}>
              Back
            </Button>
            <Box sx={{ flex: 1 }} />
            <Button
              variant="contained"
              size="large"
              disabled={primaryDisabled || submitting}
              onClick={onPrimary}
              sx={{ minHeight: 52, minWidth: 140 }}
              startIcon={primaryIcon ?? null}
            >
              {primaryLabel}
            </Button>
          </Stack>
        </Stack>
      </CardContent>
    </Card>
  );
}

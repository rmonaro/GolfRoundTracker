import { useMemo, useState } from 'react';
import {
  Box,
  Button,
  Card,
  CardActionArea,
  CardContent,
  Chip,
  Drawer,
  IconButton,
  Slider,
  Stack,
  Switch,
  ToggleButton,
  ToggleButtonGroup,
  Typography
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded';
import { useNavigate } from 'react-router-dom';
import { useBagStore } from '@/stores/bagStore';
import { useDrillRunStore } from '@/stores/drillRunStore';
import { CATEGORY_META, DRILLS } from '@/features/range/drills/registry';
import { defaultConfig } from '@/features/range/drills/engine';
import { bagToDrillClubs } from '@/features/range/drills/fromBag';
import type { DrillCategory, DrillDefinition, SetupField } from '@/features/range/drills/types';
import { practicePageSx } from '../practice/practicePageSx';

// Category accent → theme palette key (signals intent; Transfer = harder/higher-value).
const CATEGORY_PALETTE: Record<DrillCategory, 'info' | 'success' | 'warning'> = {
  foundation: 'info',
  skill: 'success',
  transfer: 'warning'
};

export function DrillsPage() {
  const navigate = useNavigate();
  const bag = useBagStore((s) => s.clubs);
  const drillClubs = useMemo(() => bagToDrillClubs(bag), [bag]);
  const setSelection = useDrillRunStore((s) => s.setSelection);

  const [active, setActive] = useState<DrillDefinition | null>(null);
  const [config, setConfig] = useState<Record<string, unknown>>({});

  const openSetup = (drill: DrillDefinition) => {
    setConfig(defaultConfig(drill.setupSchema, drillClubs));
    setActive(drill);
  };

  const grouped = useMemo(() => {
    const cats = (Object.keys(CATEGORY_META) as DrillCategory[]).sort(
      (a, b) => CATEGORY_META[a].order - CATEGORY_META[b].order
    );
    return cats.map((cat) => ({ cat, drills: DRILLS.filter((d) => d.category === cat) }));
  }, []);

  const start = () => {
    if (!active) return;
    setSelection({ drillId: active.id, config });
    setActive(null);
    navigate('/drills/run');
  };

  // A clubs field (if any) must have at least one club selected.
  const clubsField = active?.setupSchema.find((f) => f.kind === 'clubs');
  const canStart =
    !clubsField || ((config[clubsField.key] as string[] | undefined)?.length ?? 0) > 0;

  return (
    <Box sx={practicePageSx(620)}>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
        <IconButton edge="start" onClick={() => navigate('/practice')} aria-label="Back">
          <ArrowBackRoundedIcon />
        </IconButton>
      </Stack>
      <Typography component="h1" sx={{ fontWeight: 900, fontSize: '32px', lineHeight: 1.1 }}>
        Practice drills
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
        Structured practice on the GPS range. Pick a drill — the app calls the shots, scores each one,
        and gives you a report.
      </Typography>

      <Stack spacing={2.5} sx={{ mt: 2.5 }}>
        {grouped.map(({ cat, drills }) => {
          const color = CATEGORY_PALETTE[cat];
          return (
            <Box key={cat}>
              <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
                <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: `${color}.main` }} />
                <Typography sx={{ fontWeight: 800 }}>{CATEGORY_META[cat].label}</Typography>
                <Typography variant="caption" color="text.secondary">
                  {CATEGORY_META[cat].blurb}
                </Typography>
              </Stack>
              <Stack spacing={1.5}>
                {drills.map((drill) => (
                  <Card
                    key={drill.id}
                    variant="outlined"
                    sx={{ borderRadius: '5px', borderLeft: 4, borderLeftColor: `${color}.main` }}
                  >
                    <CardActionArea onClick={() => openSetup(drill)}>
                      <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
                        <Stack direction="row" alignItems="center" justifyContent="space-between">
                          <Box sx={{ minWidth: 0, pr: 1 }}>
                            <Typography sx={{ fontWeight: 800, fontSize: '1.1rem' }}>{drill.name}</Typography>
                            <Typography variant="body2" color="text.secondary">
                              {drill.blurb}
                            </Typography>
                            <Typography variant="caption" sx={{ color: `${color}.main`, display: 'block', mt: 0.5 }}>
                              {drill.why}
                            </Typography>
                          </Box>
                          <ChevronRightRoundedIcon sx={{ color: 'text.disabled', flexShrink: 0 }} />
                        </Stack>
                      </CardContent>
                    </CardActionArea>
                  </Card>
                ))}
              </Stack>
            </Box>
          );
        })}
      </Stack>

      {/* Setup sheet — renders the drill's setupSchema generically. */}
      <Drawer
        anchor="bottom"
        open={!!active}
        onClose={() => setActive(null)}
        PaperProps={{
          sx: {
            borderTopLeftRadius: 16,
            borderTopRightRadius: 16,
            maxHeight: '85dvh',
            bgcolor: 'background.default'
          }
        }}
      >
        {active && (
          <Box sx={{ p: 3, pb: 'calc(16px + env(safe-area-inset-bottom))' }}>
            <Stack direction="row" alignItems="flex-start" justifyContent="space-between" sx={{ mb: 1 }}>
              <Box sx={{ pr: 1 }}>
                <Typography sx={{ fontWeight: 900, fontSize: '1.5rem', lineHeight: 1.1 }}>{active.name}</Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                  {active.why}
                </Typography>
              </Box>
              <IconButton size="small" onClick={() => setActive(null)} aria-label="Close">
                <CloseRoundedIcon />
              </IconButton>
            </Stack>

            <Stack spacing={2.5} sx={{ mt: 1.5 }}>
              {active.setupSchema.map((field) => (
                <SetupFieldRow
                  key={field.key}
                  field={field}
                  value={config[field.key]}
                  clubLabels={drillClubs.map((c) => c.label)}
                  onChange={(v) => setConfig((prev) => ({ ...prev, [field.key]: v }))}
                />
              ))}
            </Stack>

            <Button
              variant="contained"
              fullWidth
              disabled={!canStart}
              sx={{ mt: 3 }}
              onClick={start}
            >
              {canStart ? 'Start drill' : 'Pick at least one club'}
            </Button>
          </Box>
        )}
      </Drawer>
    </Box>
  );
}

function SetupFieldRow({
  field,
  value,
  clubLabels,
  onChange
}: {
  field: SetupField;
  value: unknown;
  clubLabels: string[];
  onChange: (v: unknown) => void;
}) {
  if (field.kind === 'clubs') {
    const selected = new Set((value as string[] | undefined) ?? []);
    const toggle = (label: string) => {
      const next = new Set(selected);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      onChange([...next]);
    };
    return (
      <Box>
        <FieldLabel label={field.label} help={field.help} />
        {clubLabels.length === 0 ? (
          <Typography variant="caption" color="text.secondary">
            No clubs in your bag yet.
          </Typography>
        ) : (
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
            {clubLabels.map((label) => {
              const on = selected.has(label);
              return (
                <Chip
                  key={label}
                  label={label}
                  onClick={() => toggle(label)}
                  color={on ? 'primary' : 'default'}
                  variant={on ? 'filled' : 'outlined'}
                  sx={{ borderRadius: '6px' }}
                />
              );
            })}
          </Box>
        )}
      </Box>
    );
  }

  if (field.kind === 'number') {
    const v = typeof value === 'number' ? value : field.default;
    return (
      <Box>
        <Stack direction="row" alignItems="center" justifyContent="space-between">
          <FieldLabel label={field.label} help={field.help} dense />
          <Typography sx={{ fontWeight: 800 }}>
            {v}
            {field.suffix ?? ''}
          </Typography>
        </Stack>
        <Slider
          value={v}
          min={field.min}
          max={field.max}
          step={field.step ?? 1}
          valueLabelDisplay="auto"
          onChange={(_, nv) => onChange(nv as number)}
        />
      </Box>
    );
  }

  if (field.kind === 'toggle') {
    const v = value === true;
    return (
      <Stack direction="row" alignItems="center" justifyContent="space-between">
        <FieldLabel label={field.label} help={field.help} dense />
        <Switch checked={v} onChange={(e) => onChange(e.target.checked)} />
      </Stack>
    );
  }

  // select
  const v = typeof value === 'string' ? value : field.default;
  return (
    <Box>
      <FieldLabel label={field.label} help={field.help} />
      <ToggleButtonGroup
        exclusive
        size="small"
        value={v}
        onChange={(_, nv) => nv && onChange(nv)}
        sx={{ flexWrap: 'wrap' }}
      >
        {field.options.map((o) => (
          <ToggleButton key={o.value} value={o.value} sx={{ textTransform: 'none' }}>
            {o.label}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
    </Box>
  );
}

function FieldLabel({ label, help, dense }: { label: string; help?: string; dense?: boolean }) {
  return (
    <Box sx={{ mb: dense ? 0 : 0.75 }}>
      <Typography sx={{ fontWeight: 700 }}>{label}</Typography>
      {help && (
        <Typography variant="caption" color="text.secondary">
          {help}
        </Typography>
      )}
    </Box>
  );
}

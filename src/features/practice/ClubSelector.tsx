import { FormControl, InputLabel, MenuItem, Select } from '@mui/material';
import { useBagStore } from '@/stores/bagStore';

/** Pick the club for the practice session from the user's bag. */
export function ClubSelector({
  value,
  onChange,
  label = 'Club'
}: {
  value: string | null;
  onChange: (clubId: string | null) => void;
  label?: string;
}) {
  const bag = useBagStore((s) => s.clubs);

  return (
    <FormControl fullWidth size="small">
      <InputLabel id="practice-club-label">{label}</InputLabel>
      <Select
        labelId="practice-club-label"
        label={label}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value ? String(e.target.value) : null)}
      >
        <MenuItem value="">
          <em>No club selected</em>
        </MenuItem>
        {bag.map((c) => (
          <MenuItem key={c.clubId} value={c.clubId}>
            {c.customName || c.name}
            {c.typicalDistanceYards ? ` · ${c.typicalDistanceYards}y` : ''}
          </MenuItem>
        ))}
      </Select>
    </FormControl>
  );
}

import { ToggleButtonGroup, ToggleButton } from '@mui/material';

interface Option<T extends string> {
  label: string;
  value: T;
}

interface ToggleGroupProps<T extends string> {
  value: T | null;
  options: Array<Option<T>>;
  onChange: (v: T | null) => void;
  size?: 'small' | 'medium' | 'large';
  fullWidth?: boolean;
}

export function ToggleGroup<T extends string>({
  value,
  options,
  onChange,
  size = 'large',
  fullWidth = true
}: ToggleGroupProps<T>) {
  return (
    <ToggleButtonGroup
      exclusive
      value={value}
      onChange={(_, v) => onChange((v as T) ?? null)}
      fullWidth={fullWidth}
      sx={{
        gap: 0.5,
        flexWrap: 'wrap',
        '& .MuiToggleButton-root': {
          flex: '1 1 0',
          minHeight: size === 'large' ? 56 : size === 'medium' ? 44 : 36,
          borderRadius: 2,
          textTransform: 'none',
          fontWeight: 600,
          border: '1px solid',
          borderColor: 'divider'
        },
        '& .Mui-selected': {
          bgcolor: 'primary.main',
          color: 'primary.contrastText',
          '&:hover': { bgcolor: 'primary.dark' }
        }
      }}
    >
      {options.map((opt) => (
        <ToggleButton key={opt.value} value={opt.value}>
          {opt.label}
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
  );
}

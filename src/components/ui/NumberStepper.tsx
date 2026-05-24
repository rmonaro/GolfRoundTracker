import { Box, IconButton, Typography } from '@mui/material';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import RemoveRoundedIcon from '@mui/icons-material/RemoveRounded';

interface NumberStepperProps {
  label?: string;
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
  step?: number;
}

export function NumberStepper({ label, value, onChange, min = 0, max = 99, step = 1 }: NumberStepperProps) {
  const dec = () => onChange(Math.max(min, value - step));
  const inc = () => onChange(Math.min(max, value + step));
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', flex: 1 }}>
      {label && (
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ textTransform: 'uppercase', letterSpacing: 0.5, mb: 0.5, textAlign: 'center' }}
        >
          {label}
        </Typography>
      )}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          bgcolor: 'background.paper',
          borderRadius: 3,
          border: '1px solid',
          borderColor: 'divider',
          px: 1,
          py: 0.5,
          minHeight: 64
        }}
      >
        <IconButton
          aria-label="decrease"
          size="large"
          onClick={dec}
          sx={{
            bgcolor: 'action.hover',
            width: 48,
            height: 48,
            '&:hover': { bgcolor: 'action.selected' }
          }}
        >
          <RemoveRoundedIcon fontSize="medium" />
        </IconButton>
        <Typography variant="h4" sx={{ fontWeight: 700, minWidth: 48, textAlign: 'center' }}>
          {value}
        </Typography>
        <IconButton
          aria-label="increase"
          size="large"
          onClick={inc}
          sx={{
            bgcolor: 'primary.main',
            color: 'primary.contrastText',
            width: 48,
            height: 48,
            '&:hover': { bgcolor: 'primary.dark' }
          }}
        >
          <AddRoundedIcon fontSize="medium" />
        </IconButton>
      </Box>
    </Box>
  );
}

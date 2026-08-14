import type { ReactNode } from 'react';
import { Box, ButtonBase, Stack, Typography } from '@mui/material';

interface HomeSummaryRowProps {
  icon: ReactNode;
  /** Background of the leading icon tile — a wash or a tinted accent. */
  iconBg: string;
  iconColor: string;
  eyebrow: string;
  title: string;
  subtitle: string;
  value: string;
  valueColor: string;
  valueNote: string;
  onClick: () => void;
}

/**
 * The "Last Round" / "Last Practice" row: icon tile, three lines of identity,
 * and the headline number on the right. One component for both because they are
 * the same object at different scales — drifting apart would read as a bug.
 */
export function HomeSummaryRow({
  icon,
  iconBg,
  iconColor,
  eyebrow,
  title,
  subtitle,
  value,
  valueColor,
  valueNote,
  onClick
}: HomeSummaryRowProps) {
  return (
    <ButtonBase
      onClick={onClick}
      sx={{
        width: '100%',
        textAlign: 'left',
        bgcolor: 'background.paper',
        borderRadius: '5px',
        p: 2,
        display: 'flex',
        alignItems: 'center',
        gap: 1.75,
        '&:hover': { bgcolor: 'action.hover' }
      }}
    >
      <Box
        sx={{
          flex: '0 0 auto',
          width: 44,
          height: 44,
          borderRadius: '5px',
          display: 'grid',
          placeItems: 'center',
          background: iconBg,
          color: iconColor
        }}
      >
        {icon}
      </Box>

      <Stack spacing={0.25} sx={{ flex: '1 1 auto', minWidth: 0 }}>
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ textTransform: 'uppercase', letterSpacing: '0.6px' }}
          noWrap
        >
          {eyebrow}
        </Typography>
        <Typography sx={{ fontSize: '1.15rem', fontWeight: 700, letterSpacing: '-0.01em' }} noWrap>
          {title}
        </Typography>
        <Typography sx={{ fontSize: '0.85rem', color: 'text.secondary' }} noWrap>
          {subtitle}
        </Typography>
      </Stack>

      <Stack spacing={0.25} sx={{ flex: '0 0 auto', textAlign: 'right' }}>
        <Typography sx={{ fontSize: '1.9rem', fontWeight: 800, lineHeight: 1, color: valueColor }}>
          {value}
        </Typography>
        <Typography sx={{ fontSize: '0.8rem', color: 'text.secondary' }}>{valueNote}</Typography>
      </Stack>
    </ButtonBase>
  );
}

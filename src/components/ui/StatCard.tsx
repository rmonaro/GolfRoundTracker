import { Card, CardContent, Typography, Box } from '@mui/material';
import type { ReactNode } from 'react';

interface StatCardProps {
  label: string;
  value: ReactNode;
  hint?: string;
  accent?: 'primary' | 'success' | 'warning' | 'info' | 'default';
}

export function StatCard({ label, value, hint, accent = 'default' }: StatCardProps) {
  const color =
    accent === 'default' ? 'text.primary' : (`${accent}.main` as `${typeof accent}.main`);
  return (
    <Card elevation={0} sx={{ bgcolor: 'background.paper', height: '100%', borderRadius: '5px' }}>
      <CardContent sx={{ p: 2 }}>
        <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 0.5 }}>
          {label}
        </Typography>
        <Box sx={{ mt: 0.5 }}>
          <Typography variant="h4" sx={{ color, fontWeight: 700, lineHeight: 1.1 }}>
            {value}
          </Typography>
        </Box>
        {hint && (
          <Typography variant="caption" color="text.secondary">
            {hint}
          </Typography>
        )}
      </CardContent>
    </Card>
  );
}

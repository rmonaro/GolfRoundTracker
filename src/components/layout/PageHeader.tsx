import { Box, IconButton, Typography } from '@mui/material';
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded';
import { useNavigate } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import type { ReactNode } from 'react';

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  back?: boolean | string;
  action?: ReactNode;
}

// On the Capacitor native shell the webview goes edge-to-edge (contentInset:
// 'never'), so the title would otherwise sit under the iOS status bar / time.
// Push it below the safe area + a small gap so it clears the time on every
// device. Web build keeps the default `pt: 2`.
const isNative = Capacitor.isNativePlatform();

export function PageHeader({ title, subtitle, back, action }: PageHeaderProps) {
  const navigate = useNavigate();
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        px: 2,
        pt: isNative ? 'calc(env(safe-area-inset-top) + 1px)' : 2,
        pb: 1
      }}
    >
      {back && (
        <IconButton
          aria-label="Back"
          onClick={() => (typeof back === 'string' ? navigate(back) : navigate(-1))}
          sx={{ ml: -1 }}
        >
          <ArrowBackRoundedIcon />
        </IconButton>
      )}
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="h5" sx={{ lineHeight: 1.1 }} noWrap>
          {title}
        </Typography>
        {subtitle && (
          <Typography variant="body2" color="text.secondary" noWrap>
            {subtitle}
          </Typography>
        )}
      </Box>
      {action}
    </Box>
  );
}

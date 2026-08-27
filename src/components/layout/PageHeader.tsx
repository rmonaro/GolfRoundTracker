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
//
// This padding is also what covers the safe area once the header is pinned —
// see the sticky block below — which is why `MobileShell`'s scroll container
// no longer applies a top inset of its own. Every screen inside the shell
// renders a PageHeader, so nothing is left uninset.
const isNative = Capacitor.isNativePlatform();

export function PageHeader({ title, subtitle, back, action }: PageHeaderProps) {
  const navigate = useNavigate();
  return (
    <Box
      sx={{
        // Pinned: the header stays put and the page scrolls beneath it. Sticky
        // rather than fixed so it keeps its place in the flow — it needs no
        // spacer element, and it works unchanged whether the scroll container
        // is the document (standalone routes) or MobileShell's inner Box.
        // Every consumer renders this as the first child of a plain root Box,
        // so there is no clipping/transformed ancestor to break it.
        position: 'sticky',
        top: 0,
        // Above page content, below MUI's modal layer (Dialog 1300 / Drawer
        // 1200) so sheets and dialogs still cover the header.
        zIndex: (t) => t.zIndex.appBar,
        // Opaque, or the content scrolling underneath shows through. Matches
        // the app background every consumer sits on.
        bgcolor: 'background.default',
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
        <Typography variant="h5" sx={{ fontWeight: 900, fontSize: '32px', lineHeight: 1.1 }} noWrap>
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

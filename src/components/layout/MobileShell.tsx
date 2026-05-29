import { useEffect } from 'react';
import { Box, Paper, BottomNavigation, BottomNavigationAction } from '@mui/material';
import HomeRoundedIcon from '@mui/icons-material/HomeRounded';
import GolfCourseRoundedIcon from '@mui/icons-material/GolfCourseRounded';
import InsightsRoundedIcon from '@mui/icons-material/InsightsRounded';
import SportsGolfRoundedIcon from '@mui/icons-material/SportsGolfRounded';
import SettingsRoundedIcon from '@mui/icons-material/SettingsRounded';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';

const NAV_TABS = [
  { value: '/', label: 'Home', icon: <HomeRoundedIcon /> },
  { value: '/round', label: 'Round', icon: <GolfCourseRoundedIcon /> },
  { value: '/stats', label: 'Stats', icon: <InsightsRoundedIcon /> },
  { value: '/bag', label: 'Bag', icon: <SportsGolfRoundedIcon /> },
  { value: '/settings', label: 'Settings', icon: <SettingsRoundedIcon /> }
];

export function MobileShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const activeTab =
    NAV_TABS.find((t) => t.value !== '/' && location.pathname.startsWith(t.value))?.value ?? '/';

  // Full-screen routes — the in-round hole tracking screen owns its own header
  // and floating controls, and the map experience benefits from edge-to-edge
  // real estate. Hide the bottom nav AND lock the scroll container so the
  // viewport is exactly the device dimensions (no rubber-band scroll on iOS).
  const fullScreen = location.pathname.startsWith('/round/play');

  // iOS PWA scroll lock. position: fixed + anchoring body to all four
  // viewport edges (top/right/bottom/left: 0) removes the document from the
  // scrollable layer AND reliably extends body to the full screen including
  // safe-area-inset zones — `height: 100%` alone isn't enough on iOS, where
  // 100% of html doesn't always include the safe areas. The inner Box below
  // is the real scroll container; locking the body just stops it from being
  // the scroller.
  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const prev = {
      htmlOverflow: html.style.overflow,
      bodyPosition: body.style.position,
      bodyOverflow: body.style.overflow,
      bodyTop: body.style.top,
      bodyRight: body.style.right,
      bodyBottom: body.style.bottom,
      bodyLeft: body.style.left,
      bodyWidth: body.style.width,
      bodyHeight: body.style.height
    };
    html.style.overflow = 'hidden';
    body.style.position = 'fixed';
    body.style.overflow = 'hidden';
    body.style.top = '0';
    body.style.right = '0';
    body.style.bottom = '0';
    body.style.left = '0';
    body.style.width = '';
    body.style.height = '';
    return () => {
      html.style.overflow = prev.htmlOverflow;
      body.style.position = prev.bodyPosition;
      body.style.overflow = prev.bodyOverflow;
      body.style.top = prev.bodyTop;
      body.style.right = prev.bodyRight;
      body.style.bottom = prev.bodyBottom;
      body.style.left = prev.bodyLeft;
      body.style.width = prev.bodyWidth;
      body.style.height = prev.bodyHeight;
    };
  }, []);

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        height: '100dvh',
        width: '100vw',
        bgcolor: 'background.default',
        // Outer lock — kills body-level overscroll on iOS Safari that some-
        // times bleeds in even when the inner container is overflow: hidden.
        overflow: 'hidden'
      }}
    >
      <Box
        sx={{
          flex: 1,
          // Page body scrolls in normal routes, locks on full-screen ones.
          overflowY: fullScreen ? 'hidden' : 'auto',
          overflowX: 'hidden',
          // Full-screen routes manage their own safe-area padding (see the
          // HoleTrackingPage sticky header / FABs). Normal routes still
          // honor the top safe area + bottom-nav reservation.
          paddingTop: fullScreen ? 0 : 'env(safe-area-inset-top)',
          paddingBottom: fullScreen ? 0 : 'calc(90px + env(safe-area-inset-bottom))'
        }}
      >
        <Outlet />
      </Box>
      {!fullScreen && (
        <Paper
          elevation={8}
          sx={{
            position: 'fixed',
            bottom: 0,
            left: 0,
            right: 0,
            borderTop: 1,
            borderColor: 'divider',
            // One continuous nav surface from the top divider all the way
            // down to the screen's bottom pixel. The home-indicator
            // safe-area zone is the Paper's bottom padding so it inherits
            // the same paper bg as the icon row — no perceived "strip
            // below the nav," and on iOS the nav reads as anchored to the
            // screen edge.
            bgcolor: 'background.paper',
            paddingBottom: 'env(safe-area-inset-bottom)',
            zIndex: 10
          }}
        >
          <BottomNavigation
            value={activeTab}
            onChange={(_, val) => navigate(val)}
            showLabels
            sx={{
              // 80px icon row (70px standard + 10px breathing room above).
              // Transparent so Paper's bg shows through uniformly.
              height: 80,
              paddingTop: '10px',
              alignItems: 'flex-start',
              bgcolor: 'transparent'
            }}
          >
            {NAV_TABS.map((tab) => (
              <BottomNavigationAction
                key={tab.value}
                value={tab.value}
                label={tab.label}
                icon={tab.icon}
                sx={{ minWidth: 'unset', fontSize: '0.75rem' }}
              />
            ))}
          </BottomNavigation>
        </Paper>
      )}
    </Box>
  );
}

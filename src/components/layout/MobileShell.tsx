import { useEffect } from 'react';
import { Box, Paper, BottomNavigation, BottomNavigationAction } from '@mui/material';
import HomeRoundedIcon from '@mui/icons-material/HomeRounded';
import GolfCourseRoundedIcon from '@mui/icons-material/GolfCourseRounded';
import InsightsRoundedIcon from '@mui/icons-material/InsightsRounded';
import SportsGolfRoundedIcon from '@mui/icons-material/SportsGolfRounded';
import WatchRoundedIcon from '@mui/icons-material/WatchRounded';
import EmojiEventsRoundedIcon from '@mui/icons-material/EmojiEventsRounded';
import AssignmentIndRoundedIcon from '@mui/icons-material/AssignmentIndRounded';
import SettingsRoundedIcon from '@mui/icons-material/SettingsRounded';
import { Capacitor } from '@capacitor/core';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAppModeStore } from '@/stores/appModeStore';
import { useTournamentAccess } from '@/features/appMode/useTournamentAccess';
import { lockDocumentScroll } from '@/utils/scrollLock';
import { NAV_CONTENT_INSET, bottomNavSx } from '@/components/layout/bottomNavStyles';

// Practice tab icon: Apple Watch silhouette on iOS, generic round watch on
// Android/web — mirrors the platform watch treatment on the practice screen.
// Uses currentColor so it tints with the active/inactive nav state.
const AppleWatchNavIcon = (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
    <rect x="6.5" y="6" width="11" height="12" rx="3.2" stroke="currentColor" strokeWidth="1.7" />
    <path
      d="M8.5 6 9 3.2A1.4 1.4 0 0 1 10.4 2h3.2a1.4 1.4 0 0 1 1.4 1.2L15.5 6M8.5 18l.5 2.8A1.4 1.4 0 0 0 10.4 22h3.2a1.4 1.4 0 0 0 1.4-1.2L15.5 18"
      stroke="currentColor"
      strokeWidth="1.7"
    />
  </svg>
);
const watchTabIcon = Capacitor.getPlatform() === 'ios' ? AppleWatchNavIcon : <WatchRoundedIcon />;

// Round sits in the CENTRE — it's the thing the app is for, and the middle slot
// is the easiest reach on a phone. The rest keep their relative order around it.
const ROUNDS_TABS = [
  { value: '/', label: 'Home', icon: <HomeRoundedIcon /> },
  { value: '/stats', label: 'Stats', icon: <InsightsRoundedIcon /> },
  { value: '/round', label: 'Round', icon: <GolfCourseRoundedIcon /> },
  { value: '/bag', label: 'Bag', icon: <SportsGolfRoundedIcon /> },
  { value: '/practice', label: 'Practice', icon: watchTabIcon }
];

// The tournament side is deliberately narrow: play your events, keep someone
// else's card, adjust your account. Stats, bag and practice belong to the
// rounds side and are reached by switching there.
//
// Scoring is not part of playing — it only exists for someone an admin assigned
// to keep another player's card. An athlete playing their own event never sees
// the tab, so it's added only when there's an actual assignment.
const tournamentTabs = (canScore: boolean) => [
  { value: '/tournaments', label: 'Tournaments', icon: <EmojiEventsRoundedIcon /> },
  ...(canScore
    ? [{ value: '/scoring', label: 'Scoring', icon: <AssignmentIndRoundedIcon /> }]
    : []),
  { value: '/settings', label: 'Settings', icon: <SettingsRoundedIcon /> }
];

export function MobileShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const mode = useAppModeStore((s) => s.mode);
  const { scorerGroupCount } = useTournamentAccess();
  const navTabs = mode === 'tournament' ? tournamentTabs(scorerGroupCount > 0) : ROUNDS_TABS;
  const activeTab =
    navTabs.find((t) => t.value !== '/' && location.pathname.startsWith(t.value))?.value ??
    navTabs[0].value;

  // Full-screen routes — the in-round hole tracking screen owns its own header
  // and floating controls, and the map experience benefits from edge-to-edge
  // real estate. Hide the bottom nav AND lock the scroll container so the
  // viewport is exactly the device dimensions (no rubber-band scroll on iOS).
  const fullScreen = location.pathname.startsWith('/round/play');

  // Routes that supply their OWN bottom bar in place of the app nav — Settings
  // swaps in its section tabs (Profile / Settings / Courses). The body's bottom
  // padding is deliberately kept: the replacement bar occupies the same strip,
  // so the reserved space is still needed.
  const ownsBottomBar = location.pathname.startsWith('/settings');

  // iOS PWA scroll lock — see `lockDocumentScroll`. The inner Box below is the
  // real scroll container; pinning the body just stops it from being a second
  // scroller that rubber-bands on iOS.
  useEffect(() => lockDocumentScroll(), []);

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
          // No top inset here on purpose. PageHeader is pinned (position:
          // sticky) and every screen in the shell renders one, so IT owns the
          // top safe area. Padding on the scroll container would sit ABOVE the
          // pinned header instead — a strip the page's content visibly scrolls
          // through, since a scroller's padding box is part of its scrollport.
          // Full-screen routes manage their own insets (see the
          // HoleTrackingPage sticky header / FABs).
          paddingBottom: fullScreen ? 0 : NAV_CONTENT_INSET
        }}
      >
        <Outlet />
      </Box>
      {!fullScreen && !ownsBottomBar && (
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
            sx={bottomNavSx}
          >
            {navTabs.map((tab) => (
              <BottomNavigationAction
                key={tab.value}
                value={tab.value}
                label={tab.label}
                icon={tab.icon}
              />
            ))}
          </BottomNavigation>
        </Paper>
      )}
    </Box>
  );
}

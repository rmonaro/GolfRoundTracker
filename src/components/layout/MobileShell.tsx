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

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        height: '100dvh',
        width: '100vw',
        bgcolor: 'background.default'
      }}
    >
      <Box
        sx={{
          flex: 1,
          overflowY: 'auto',
          overflowX: 'hidden',
          paddingTop: 'env(safe-area-inset-top)',
          paddingBottom: 'calc(80px + env(safe-area-inset-bottom))'
        }}
      >
        <Outlet />
      </Box>
      <Paper
        elevation={8}
        sx={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          borderTop: 1,
          borderColor: 'divider',
          paddingBottom: 'env(safe-area-inset-bottom)',
          zIndex: 10
        }}
      >
        <BottomNavigation
          value={activeTab}
          onChange={(_, val) => navigate(val)}
          showLabels
          sx={{ height: 70 }}
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
    </Box>
  );
}

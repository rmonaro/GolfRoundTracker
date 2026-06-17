import { Box, Tab, Tabs } from '@mui/material';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { PageHeader } from '@/components/layout/PageHeader';
import { DesktopOnly } from '../components/DesktopOnly';

const TABS = [
  { value: '/admin', label: 'Overview', exact: true },
  { value: '/admin/users', label: 'Users', exact: false },
  { value: '/admin/rounds', label: 'Rounds', exact: false },
  { value: '/admin/courses', label: 'Courses', exact: false },
  { value: '/admin/courses/import', label: 'Import', exact: false },
  { value: '/admin/review', label: 'Review', exact: false }
];

export function AdminLayout() {
  const location = useLocation();
  const navigate = useNavigate();

  // Pick the most-specific matching tab (Import beats Courses since it's a sub-path).
  const active =
    [...TABS]
      .sort((a, b) => b.value.length - a.value.length)
      .find((t) => (t.exact ? location.pathname === t.value : location.pathname.startsWith(t.value)))
      ?.value ?? '/admin';

  return (
    <DesktopOnly>
      <Box sx={{ minHeight: '100dvh', bgcolor: 'background.default' }}>
        <PageHeader title="Admin" back="/settings" />
        <Box sx={{ maxWidth: 1200, mx: 'auto', width: '100%' }}>
          <Tabs
            value={active}
            onChange={(_, v) => navigate(v)}
            variant="scrollable"
            scrollButtons="auto"
            sx={{ borderBottom: 1, borderColor: 'divider', mx: 2 }}
          >
            {TABS.map((t) => (
              <Tab key={t.value} value={t.value} label={t.label} sx={{ minHeight: 48, textTransform: 'none' }} />
            ))}
          </Tabs>
          <Outlet />
        </Box>
      </Box>
    </DesktopOnly>
  );
}

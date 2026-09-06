import { Box, List, ListItemButton, ListItemText, ListSubheader } from '@mui/material';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { PageHeader } from '@/components/layout/PageHeader';
import { DesktopOnly } from '../components/DesktopOnly';

interface NavItem {
  value: string;
  label: string;
  /** Match the path exactly. Only /admin needs this — every other section is a
   *  prefix of its own detail routes. */
  exact?: boolean;
}

/**
 * Grouped rather than one flat list: the course tools outnumber everything else
 * and were becoming hard to scan as a row of tabs.
 */
const NAV: Array<{ heading: string; items: NavItem[] }> = [
  {
    heading: 'Admin',
    items: [
      { value: '/admin', label: 'Overview', exact: true },
      { value: '/admin/users', label: 'Users' },
      { value: '/admin/rounds', label: 'Rounds' }
    ]
  },
  {
    heading: 'Courses',
    items: [
      { value: '/admin/courses', label: 'All courses' },
      { value: '/admin/courses/import', label: 'Import' },
      { value: '/admin/courses/state-import', label: 'Bulk import' },
      { value: '/admin/review', label: 'Hole review' }
    ]
  }
];

const ALL_ITEMS = NAV.flatMap((g) => g.items);

export function AdminLayout() {
  const location = useLocation();
  const navigate = useNavigate();

  // Most-specific match wins, so /admin/courses/import highlights Import rather
  // than All courses. Sorting by length is what makes that hold no matter what
  // order the groups above are written in.
  const active =
    [...ALL_ITEMS]
      .sort((a, b) => b.value.length - a.value.length)
      .find((t) =>
        t.exact ? location.pathname === t.value : location.pathname.startsWith(t.value)
      )?.value ?? '/admin';

  return (
    <DesktopOnly>
      <Box sx={{ minHeight: '100dvh', bgcolor: 'background.default' }}>
        <PageHeader title="Admin" back="/settings" />
        <Box sx={{ display: 'flex', maxWidth: 1400, mx: 'auto', width: '100%' }}>
          <Box
            component="nav"
            sx={{
              width: 190,
              flexShrink: 0,
              borderRight: 1,
              borderColor: 'divider',
              // Full height so the divider runs the length of the page rather
              // than stopping under the last link.
              minHeight: 'calc(100dvh - 64px)',
              py: 1
            }}
          >
            {NAV.map((group) => (
              <List
                key={group.heading}
                dense
                disablePadding
                subheader={
                  <ListSubheader
                    disableSticky
                    sx={{ bgcolor: 'transparent', lineHeight: '32px', fontSize: 12 }}
                  >
                    {group.heading}
                  </ListSubheader>
                }
                sx={{ mb: 1 }}
              >
                {group.items.map((item) => (
                  <ListItemButton
                    key={item.value}
                    selected={active === item.value}
                    onClick={() => navigate(item.value)}
                    sx={{
                      py: 0.75,
                      pl: 2.5,
                      borderLeft: 2,
                      borderColor: active === item.value ? 'primary.main' : 'transparent'
                    }}
                  >
                    <ListItemText
                      primary={item.label}
                      primaryTypographyProps={{
                        fontSize: 14,
                        fontWeight: active === item.value ? 600 : 400
                      }}
                    />
                  </ListItemButton>
                ))}
              </List>
            ))}
          </Box>
          {/* minWidth:0 so a wide table scrolls inside the content column
              instead of pushing the nav off-screen. */}
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Outlet />
          </Box>
        </Box>
      </Box>
    </DesktopOnly>
  );
}

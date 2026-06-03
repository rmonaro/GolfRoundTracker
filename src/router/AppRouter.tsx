import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthGuard, PublicOnlyGuard } from '@/features/auth/AuthGuard';
import { AuthLayout } from '@/pages/auth/AuthLayout';
import { LoginPage } from '@/pages/auth/LoginPage';
import { SignUpPage } from '@/pages/auth/SignUpPage';
import { ForgotPasswordPage } from '@/pages/auth/ForgotPasswordPage';
import { MobileShell } from '@/components/layout/MobileShell';
import { HomePage } from '@/pages/HomePage';
import { BagPage } from '@/pages/bag/BagPage';
import { RoundHomePage } from '@/pages/round/RoundHomePage';
import { StartRoundPage } from '@/pages/round/StartRoundPage';
import { HoleTrackingPage } from '@/pages/round/HoleTrackingPage';
import { RoundSummaryPage } from '@/pages/round/RoundSummaryPage';
import { PastRoundsPage } from '@/pages/round/PastRoundsPage';
import { StatsPage } from '@/pages/stats/StatsPage';
import { SettingsPage } from '@/pages/settings/SettingsPage';
import { WatchPage } from '@/pages/watch/WatchPage';
import { PracticeStartPage } from '@/pages/practice/PracticeStartPage';
import { PracticeLivePage } from '@/pages/practice/PracticeLivePage';
import { SessionSummaryPage } from '@/pages/practice/SessionSummaryPage';
import { OnboardingPage } from '@/pages/onboarding/OnboardingPage';
import { AdminGuard } from '@/admin/AdminGuard';
import { AdminLayout } from '@/admin/pages/AdminLayout';
import { AdminOverview } from '@/admin/pages/AdminOverview';
import { AdminCoursesList } from '@/admin/pages/AdminCoursesList';
import { AdminImport } from '@/admin/pages/AdminImport';
import { AdminCourseDetail } from '@/admin/pages/AdminCourseDetail';
import { AdminReview } from '@/admin/pages/AdminReview';

export function AppRouter() {
  return (
    <Routes>
      <Route
        path="/auth"
        element={
          <PublicOnlyGuard>
            <AuthLayout />
          </PublicOnlyGuard>
        }
      >
        <Route index element={<Navigate to="login" replace />} />
        <Route path="login" element={<LoginPage />} />
        <Route path="signup" element={<SignUpPage />} />
        <Route path="forgot-password" element={<ForgotPasswordPage />} />
      </Route>

      <Route
        path="/round/play"
        element={
          <AuthGuard>
            <HoleTrackingPage />
          </AuthGuard>
        }
      />
      <Route
        path="/round/start"
        element={
          <AuthGuard>
            <StartRoundPage />
          </AuthGuard>
        }
      />
      <Route
        path="/round/summary/:roundId"
        element={
          <AuthGuard>
            <RoundSummaryPage />
          </AuthGuard>
        }
      />
      <Route
        path="/round/history"
        element={
          <AuthGuard>
            <PastRoundsPage />
          </AuthGuard>
        }
      />
      <Route
        path="/watch"
        element={
          <AuthGuard>
            <WatchPage />
          </AuthGuard>
        }
      />
      <Route
        path="/practice"
        element={
          <AuthGuard>
            <PracticeStartPage />
          </AuthGuard>
        }
      />
      <Route
        path="/practice/live"
        element={
          <AuthGuard>
            <PracticeLivePage />
          </AuthGuard>
        }
      />
      <Route
        path="/practice/summary"
        element={
          <AuthGuard>
            <SessionSummaryPage />
          </AuthGuard>
        }
      />
      <Route
        path="/onboarding"
        element={
          <AuthGuard>
            <OnboardingPage />
          </AuthGuard>
        }
      />

      <Route
        element={
          <AuthGuard>
            <MobileShell />
          </AuthGuard>
        }
      >
        <Route path="/" element={<HomePage />} />
        <Route path="/round" element={<RoundHomePage />} />
        <Route path="/stats" element={<StatsPage />} />
        <Route path="/bag" element={<BagPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Route>

      <Route
        path="/admin"
        element={
          <AdminGuard>
            <AdminLayout />
          </AdminGuard>
        }
      >
        <Route index element={<AdminOverview />} />
        <Route path="courses" element={<AdminCoursesList />} />
        <Route path="courses/import" element={<AdminImport />} />
        <Route path="courses/:id" element={<AdminCourseDetail />} />
        <Route path="review" element={<AdminReview />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

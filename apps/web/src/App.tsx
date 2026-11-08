import { ScoringSettingsPage } from "./pages/ScoringSettingsPage";
import { RouteFocus } from "./components/RouteFocus";
import { PlayerLoginPage } from "./pages/PlayerLoginPage";
import { AccountAccessPage } from "./pages/AccountAccessPage";
import { RegistrationAdminPage } from "./pages/RegistrationAdminPage";
import type { ReactNode } from "react";
import { Navigate, Outlet, Route, Routes, useLocation } from "react-router-dom";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { EmptyState, LoadingScreen, Shell } from "./components/Shell";
import { ActivityPage } from "./pages/ActivityPage";
import { ChallengesPage } from "./pages/ChallengesPage";
import { InboxPage } from "./pages/InboxPage";
import { BoardPage } from "./pages/BoardPage";
import { DesignPage } from "./pages/DesignPage";
import { HomePage } from "./pages/HomePage";
import { LogPage } from "./pages/LogPage";
import { InvitePage } from "./pages/InvitePage";
import { MembersPage } from "./pages/MembersPage";
import { ModeratePage } from "./pages/ModeratePage";
import { RulesPage } from "./pages/RulesPage";
import { TeamPage } from "./pages/TeamPage";
import { LoginPage } from "./pages/LoginPage";
import { PendingPage } from "./pages/PendingPage";
import { SetupPage } from "./pages/SetupPage";
import { OnboardingPage } from "./pages/OnboardingPage";
import { ProfilePage } from "./pages/ProfilePage";
import { SquadPage } from "./pages/SquadPage";
import { SessionProvider, useSession } from "./session";

export function App() {
  return (
    <ErrorBoundary>
      <SessionProvider>
        <RouteFocus />
        <Routes>
          <Route path="/login" element={<GuestOnly><LoginPage /></GuestOnly>} />
          <Route path="/join" element={<AccountAccessPage />} />
          <Route path="/player-login" element={<PlayerLoginPage />} />
          <Route path="/reset-password" element={<Navigate to="/login" replace />} />
          <Route path="/setup" element={<SetupPage />} />
          <Route path="/design" element={<DesignPage />} />
          <Route element={<RequireSession />}>
            <Route element={<Shell />}>
              <Route path="/" element={<HomePage />} />
              <Route path="/log" element={<LogPage />} />
              <Route path="/board" element={<BoardPage />} />
              <Route path="/activity" element={<ActivityPage />} />
              <Route path="/moderate" element={<ModeratePage />} />
              <Route path="/members" element={<MembersPage />} />
              <Route path="/rules" element={<RulesPage />} />
              <Route path="/scoring-settings" element={<ScoringSettingsPage />} />
              <Route path="/challenges" element={<ChallengesPage />} />
              <Route path="/inbox" element={<InboxPage />} />
              <Route path="/team" element={<TeamPage />} />
              <Route path="/you" element={<ProfilePage />} />
              <Route path="/registration" element={<RegistrationAdminPage />} />
              <Route path="/invite" element={<InvitePage />} />
              <Route path="/squad" element={<SquadPage />} />
              <Route path="/onboarding" element={<OnboardingPage />} />
              <Route path="/pending" element={<PendingPage />} />
            </Route>
          </Route>
        </Routes>
      </SessionProvider>
    </ErrorBoundary>
  );
}

function GuestOnly({ children }: { children: ReactNode }) {
  const { me, loading } = useSession();
  if (loading) return <LoadingScreen />;
  if (me?.pendingApproval) return <Navigate to="/pending" replace />;
  if (me?.needsOnboarding) return <Navigate to="/onboarding" replace />;
  if (me) return <Navigate to="/" replace />;
  return children;
}

function RequireSession() {
  const { me, loading, error } = useSession();
  const location = useLocation();
  if (loading) return <LoadingScreen />;
  if (!me) return <Navigate to="/login" replace />;
  if (error) return <EmptyState title="Could not load your session" body={error} />;
  const staff = me.membership.role === "coach" || me.membership.role === "admin";
  if (me.pendingApproval && location.pathname !== "/pending") return <Navigate to="/pending" replace />;
  if (!me.pendingApproval && location.pathname === "/pending") return <Navigate to="/" replace />;
  if (me.needsOnboarding && location.pathname !== "/onboarding") return <Navigate to="/onboarding" replace />;
  if (!me.needsOnboarding && location.pathname === "/onboarding" && !(staff && !me.profile)) return <Navigate to="/" replace />;
  return <Outlet />;
}

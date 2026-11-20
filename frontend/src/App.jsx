import { Route, Routes } from 'react-router-dom';
import { AdminLayout, Layout, RequireAuth } from './components/Layout';
import AccountPage from './pages/AccountPage';
import LeaderboardPage from './pages/LeaderboardPage';
import LoginPage from './pages/LoginPage';
import MatchDetailPage from './pages/MatchDetailPage';
import MatchesPage from './pages/MatchesPage';
import NotFoundPage from './pages/NotFoundPage';
import PlayerProfilePage from './pages/PlayerProfilePage';
import PlayersPage from './pages/PlayersPage';
import RegisterPage from './pages/RegisterPage';
import DashboardPage from './pages/admin/DashboardPage';
import MatchesAdminPage from './pages/admin/MatchesAdminPage';
import PlayersAdminPage from './pages/admin/PlayersAdminPage';
import RankingRulesPage from './pages/admin/RankingRulesPage';
import UsersAdminPage from './pages/admin/UsersAdminPage';

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<LeaderboardPage />} />
        <Route path="matches" element={<MatchesPage />} />
        <Route path="matches/:id" element={<MatchDetailPage />} />
        <Route path="players" element={<PlayersPage />} />
        <Route path="players/:id" element={<PlayerProfilePage />} />
        <Route path="login" element={<LoginPage />} />
        <Route path="register" element={<RegisterPage />} />
        <Route
          path="account"
          element={
            <RequireAuth>
              <AccountPage />
            </RequireAuth>
          }
        />
        <Route
          path="admin"
          element={
            <RequireAuth admin>
              <AdminLayout />
            </RequireAuth>
          }
        >
          <Route index element={<DashboardPage />} />
          <Route path="matches" element={<MatchesAdminPage />} />
          <Route path="players" element={<PlayersAdminPage />} />
          <Route path="users" element={<UsersAdminPage />} />
          <Route path="rules" element={<RankingRulesPage />} />
        </Route>
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}

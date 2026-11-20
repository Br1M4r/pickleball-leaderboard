import { useEffect, useState } from 'react';
import { Link, NavLink, Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { BallLogo, ChartIcon, CloseIcon, LogoutIcon, MenuIcon, SettingsIcon, ShieldIcon, TrophyIcon, UsersIcon, CalendarIcon } from './Icons';
import { Loader } from './UI';

export function Layout() {
  const { user, isAdmin, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const location = useLocation();

  useEffect(() => setOpen(false), [location.pathname]);

  return (
    <div className="app">
      <header className="topbar">
        <div className="container topbar-inner">
          <Link to="/" className="brand">
            <BallLogo />
            <span>
              Pickle<b>Rank</b>
            </span>
          </Link>

          <button className="icon-btn nav-toggle" onClick={() => setOpen((o) => !o)} aria-label="Toggle menu">
            {open ? <CloseIcon /> : <MenuIcon />}
          </button>

          <nav className={`nav ${open ? 'open' : ''}`}>
            <NavLink to="/" end>Leaderboard</NavLink>
            <NavLink to="/matches">Matches</NavLink>
            <NavLink to="/players">Players</NavLink>
            {isAdmin && (
              <NavLink to="/admin" className="nav-admin">
                <ShieldIcon size={16} /> Admin
              </NavLink>
            )}
            <span className="nav-spacer" />
            {user ? (
              <>
                <NavLink to="/account" className="nav-user">
                  {user.playerName || user.email}
                </NavLink>
                <button className="btn btn-sm btn-ghost-light" onClick={logout}>
                  <LogoutIcon size={16} /> Sign out
                </button>
              </>
            ) : (
              <>
                <NavLink to="/login">Sign in</NavLink>
                <Link to="/register" className="btn btn-sm btn-ball">
                  Join the league
                </Link>
              </>
            )}
          </nav>
        </div>
      </header>

      <main className="main">
        <Outlet />
      </main>

      <footer className="footer">
        <div className="container footer-inner">
          <span>
            <BallLogo size={20} /> PickleRank · Pickleball League Leaderboard
          </span>
          <span className="muted">Rankings update automatically after every recorded match.</span>
        </div>
      </footer>
    </div>
  );
}

export function AdminLayout() {
  return (
    <div className="container page">
      <nav className="admin-tabs" aria-label="Admin sections">
        <NavLink to="/admin" end><ChartIcon size={16} /> Dashboard</NavLink>
        <NavLink to="/admin/matches"><CalendarIcon size={16} /> Matches</NavLink>
        <NavLink to="/admin/players"><TrophyIcon size={16} /> Players</NavLink>
        <NavLink to="/admin/users"><UsersIcon size={16} /> Accounts</NavLink>
        <NavLink to="/admin/rules"><SettingsIcon size={16} /> Ranking rules</NavLink>
      </nav>
      <Outlet />
    </div>
  );
}

export function RequireAuth({ admin = false, children }) {
  const { user, ready, isAdmin } = useAuth();
  const location = useLocation();

  if (!ready) return <Loader text="Checking your session…" />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (admin && !isAdmin) return <Navigate to="/" replace />;
  return children;
}

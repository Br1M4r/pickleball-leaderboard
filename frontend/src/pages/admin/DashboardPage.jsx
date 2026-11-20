import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { dashboardApi, leaderboardApi } from '../../api';
import MatchCard from '../../components/MatchCard';
import { CalendarIcon, FlameIcon, RefreshIcon, TrophyIcon, UsersIcon } from '../../components/Icons';
import { Avatar, EmptyState, ErrorBanner, Loader, StatCard } from '../../components/UI';
import { useToast } from '../../context/ToastContext';
import { formatPct } from '../../utils/format';

function RankList({ rows, metric, empty }) {
  if (!rows.length) return <p className="muted">{empty}</p>;
  return (
    <ol className="rank-list">
      {rows.map((r, i) => (
        <li key={r.playerId}>
          <span className="rank-list-pos">{metric === 'rank' ? r.rank : i + 1}</span>
          <Link to={`/players/${r.playerId}`} className="player-link">
            <Avatar name={r.fullName} url={r.photoUrl} size={32} />
            <span>{r.fullName}</span>
          </Link>
          <span className="rank-list-val">
            {metric === 'rank' && <>{r.points} pts</>}
            {metric === 'rate' && <>{formatPct(r.winPercentage)} <small className="muted">({r.wins}–{r.losses})</small></>}
            {metric === 'streak' && <span className="streak hot"><FlameIcon size={14} /> {r.currentWinStreak}</span>}
          </span>
        </li>
      ))}
    </ol>
  );
}

function Bars({ items }) {
  const max = Math.max(1, ...items.map((i) => i.count));
  return (
    <div className="bars">
      {items.map((i) => (
        <div key={i.label} className="bar">
          <div className="bar-track">
            <div className="bar-fill" style={{ height: `${(i.count / max) * 100}%` }} />
          </div>
          <span className="bar-val">{i.count}</span>
          <span className="bar-label">{i.label}</span>
        </div>
      ))}
    </div>
  );
}

export default function DashboardPage() {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setError(null);
    dashboardApi.get().then(setData).catch(setError);
  }, []);

  useEffect(load, [load]);

  const recalc = async () => {
    setBusy(true);
    try {
      await leaderboardApi.recalculate();
      toast.success('Rankings recalculated from full match history.');
      load();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (error) return <ErrorBanner error={error} onRetry={load} />;
  if (!data) return <Loader text="Loading dashboard…" />;

  const totalSkill = data.skillDistribution.reduce((s, x) => s + x.count, 0) || 1;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Dashboard</h1>
          <p className="muted">League overview and performance.</p>
        </div>
        <div className="head-actions">
          <button className="btn btn-ghost" onClick={recalc} disabled={busy}>
            <RefreshIcon size={16} /> {busy ? 'Recalculating…' : 'Recalculate rankings'}
          </button>
          <Link to="/admin/matches?new=1" className="btn btn-primary">Record a match</Link>
        </div>
      </div>

      <section className="stats-grid">
        <StatCard label="Registered players" value={data.totalPlayers} sub={`${data.activePlayers} active`} icon={<UsersIcon />} />
        <StatCard label="Matches played" value={data.totalMatches} sub={`${data.singlesMatches} singles · ${data.doublesMatches} doubles`} icon={<CalendarIcon />} />
        <StatCard label="Upcoming" value={data.scheduledMatches} sub="scheduled matches" />
        <StatCard label="Wins recorded" value={data.totalWins} tone="tone-green" icon={<TrophyIcon />} />
        <StatCard label="Losses recorded" value={data.totalLosses} tone="tone-red" />
      </section>

      <div className="three-col">
        <section className="card">
          <div className="card-head">
            <h2>Top ranked</h2>
            <Link to="/" className="btn btn-sm btn-ghost">Leaderboard</Link>
          </div>
          <RankList rows={data.topPlayers} metric="rank" empty="No rankings yet." />
        </section>
        <section className="card">
          <h2>Best win rate</h2>
          <RankList rows={data.bestWinRates} metric="rate" empty="Players need 3+ matches." />
        </section>
        <section className="card">
          <h2>Hottest streaks</h2>
          <RankList rows={data.hottestStreaks} metric="streak" empty="No active win streaks." />
        </section>
      </div>

      <div className="two-col">
        <section className="card">
          <h2>Matches per month</h2>
          <Bars items={data.matchesPerMonth} />
        </section>
        <section className="card">
          <h2>Active players by skill</h2>
          <div className="skill-bars">
            {data.skillDistribution.map((s) => (
              <div key={s.label} className="skill-row">
                <span>{s.label}</span>
                <div className="skill-track">
                  <div className="skill-fill" style={{ width: `${(s.count / totalSkill) * 100}%` }} />
                </div>
                <strong>{s.count}</strong>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="card">
        <div className="card-head">
          <h2>Recent results</h2>
          <Link to="/admin/matches" className="btn btn-sm btn-ghost">All matches</Link>
        </div>
        {data.recentMatches.length === 0 ? (
          <EmptyState title="No results yet" action={<Link to="/admin/matches?new=1" className="btn btn-primary">Record the first match</Link>} />
        ) : (
          <div className="match-grid">
            {data.recentMatches.map((m) => <MatchCard key={m.id} match={m} compact />)}
          </div>
        )}
      </section>
    </>
  );
}

import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { playersApi } from '../api';
import MatchCard from '../components/MatchCard';
import { CalendarIcon, FlameIcon, TrophyIcon } from '../components/Icons';
import { Avatar, Badge, EmptyState, ErrorBanner, Loader, Pagination, RankMovement, SkillBadge, StatCard } from '../components/UI';
import { useAuth } from '../context/AuthContext';
import { formatDate, formatPct, label } from '../utils/format';

export default function PlayerProfilePage() {
  const { id } = useParams();
  const playerId = Number(id);
  const { user, isAdmin } = useAuth();
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState(null);
  const [matches, setMatches] = useState(null);
  const [page, setPage] = useState(1);

  const load = useCallback(async () => {
    setError(null);
    try {
      setDetail(await playersApi.get(playerId));
    } catch (e) {
      setError(e);
    }
  }, [playerId]);

  useEffect(() => {
    setDetail(null);
    setPage(1);
    load();
  }, [load]);

  useEffect(() => {
    playersApi.matches(playerId, { page, pageSize: 10 }).then(setMatches).catch(() => setMatches(null));
  }, [playerId, page]);

  if (error) return <div className="container page"><ErrorBanner error={error} onRetry={load} /></div>;
  if (!detail) return <Loader text="Loading player…" />;

  const { player: p, totals, standings } = detail;
  const overall = standings.find((s) => s.scope === 'Overall');
  const isMe = user?.playerId === p.id;

  return (
    <div className="container page">
      <section className="profile-head card">
        <Avatar name={p.fullName} url={p.photoUrl} size={112} className="profile-avatar" />
        <div className="profile-info">
          <div className="profile-title">
            <h1>{p.fullName}</h1>
            {!p.isActive && <Badge tone="red">Inactive</Badge>}
            {isMe && <Badge tone="gold">You</Badge>}
          </div>
          <div className="profile-tags">
            <SkillBadge level={p.skillLevel} />
            <Badge tone="outline">{p.gender}</Badge>
            <Badge tone="outline">{p.age} yrs</Badge>
            <Badge tone="outline">Plays {p.playingCategory === 'Both' ? 'singles & doubles' : p.playingCategory.toLowerCase()}</Badge>
          </div>
          <p className="muted">
            <CalendarIcon size={14} /> Member since {formatDate(p.dateRegistered)}
          </p>
          {(isMe || isAdmin) && (
            <div className="profile-actions">
              {isMe && <Link className="btn btn-sm btn-ghost" to="/account">Edit my profile</Link>}
              {isAdmin && <Link className="btn btn-sm btn-ghost" to={`/admin/players?edit=${p.id}`}>Manage player</Link>}
            </div>
          )}
        </div>
        {overall && (
          <div className="profile-rank">
            <span className="muted">Overall rank</span>
            <strong>#{overall.rank}</strong>
            <RankMovement movement={overall.movement} previousRank={overall.previousRank} />
            <span className="profile-points">{overall.points} pts</span>
          </div>
        )}
      </section>

      <section className="stats-grid">
        <StatCard label="Matches" value={totals.matchesPlayed} icon={<CalendarIcon />} />
        <StatCard label="Wins" value={totals.wins} tone="tone-green" icon={<TrophyIcon />} />
        <StatCard label="Losses" value={totals.losses} tone="tone-red" />
        <StatCard label="Win rate" value={formatPct(totals.winPercentage)} />
        <StatCard label="Current streak" value={totals.currentWinStreak} sub={`Best: ${totals.longestWinStreak}`} icon={<FlameIcon />} tone="tone-ball" />
        <StatCard label="Points for / against" value={`${totals.pointsFor} / ${totals.pointsAgainst}`} sub={`Diff ${totals.pointsFor - totals.pointsAgainst >= 0 ? '+' : ''}${totals.pointsFor - totals.pointsAgainst}`} />
      </section>

      <div className="two-col">
        <section className="card">
          <h2>Rankings by category</h2>
          {standings.length === 0 ? (
            <p className="muted">Not ranked yet — play a recorded match to enter the rankings.</p>
          ) : (
            <div className="table-wrap">
              <table className="table compact">
                <thead>
                  <tr>
                    <th>Category</th>
                    <th className="num">Rank</th>
                    <th className="num">Pts</th>
                    <th className="num">W–L</th>
                    <th className="num">Win %</th>
                  </tr>
                </thead>
                <tbody>
                  {standings.map((s) => (
                    <tr key={s.scope}>
                      <td data-label="Category">{label(s.scope)}</td>
                      <td data-label="Rank" className="num">
                        #{s.rank} <RankMovement movement={s.movement} previousRank={s.previousRank} />
                      </td>
                      <td data-label="Points" className="num points">{s.points}</td>
                      <td data-label="W–L" className="num">{s.wins}–{s.losses}</td>
                      <td data-label="Win %" className="num">{formatPct(s.winPercentage)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="card">
          <h2>Match history</h2>
          {!matches ? (
            <Loader />
          ) : matches.items.length === 0 ? (
            <EmptyState title="No matches yet" />
          ) : (
            <>
              <div className="match-list">
                {matches.items.map((m) => (
                  <MatchCard key={m.id} match={m} perspective={p.id} compact />
                ))}
              </div>
              <Pagination page={matches.page} totalPages={matches.totalPages} onChange={setPage} />
            </>
          )}
        </section>
      </div>
    </div>
  );
}

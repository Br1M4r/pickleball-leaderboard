import { Link } from 'react-router-dom';
import { formatPct } from '../utils/format';
import { ArrowDownIcon, ArrowUpIcon, FlameIcon, TrophyIcon } from './Icons';
import { Avatar, RankMovement, SkillBadge } from './UI';

const MEDALS = { 1: 'gold', 2: 'silver', 3: 'bronze' };

export function Podium({ rows }) {
  const top = rows.filter((r) => r.rank <= 3).slice(0, 3);
  if (top.length === 0) return null;

  // Visual order: 2nd, 1st, 3rd
  const order = [top[1], top[0], top[2]].filter(Boolean);

  return (
    <section className="podium" aria-label="Top 3 players">
      {order.map((r) => (
        <Link
          key={r.playerId}
          to={`/players/${r.playerId}`}
          className={`podium-card podium-${MEDALS[r.rank] || 'bronze'} ${r === top[0] ? 'podium-first' : ''}`}
        >
          <div className="podium-rank">
            {r.rank === 1 ? <TrophyIcon size={20} /> : null}
            <span>#{r.rank}</span>
          </div>
          <Avatar name={r.fullName} url={r.photoUrl} size={r === top[0] ? 84 : 68} className="podium-avatar" />
          <h3>{r.fullName}</h3>
          <div className="podium-points">
            <strong>{r.points}</strong> pts
          </div>
          <div className="podium-meta">
            <span>
              {r.wins}W – {r.losses}L
            </span>
            <span>{formatPct(r.winPercentage)}</span>
            {r.currentWinStreak > 1 && (
              <span className="streak">
                <FlameIcon size={14} /> {r.currentWinStreak}
              </span>
            )}
          </div>
        </Link>
      ))}
    </section>
  );
}

const COLUMNS = [
  { key: 'rank', label: 'Rank' },
  { key: 'name', label: 'Player' },
  { key: 'matches', label: 'MP', title: 'Matches played', num: true },
  { key: 'wins', label: 'W', title: 'Wins', num: true },
  { key: 'losses', label: 'L', title: 'Losses', num: true },
  { key: 'winPercentage', label: 'Win %', num: true },
  { key: 'points', label: 'Points', num: true },
  { key: 'streak', label: 'Streak', title: 'Current winning streak', num: true },
];

export function LeaderboardTable({ rows, sortBy, sortDir, onSort }) {
  const header = (c) => {
    const active = sortBy === c.key;
    return (
      <th key={c.key} className={c.num ? 'num' : ''} title={c.title} aria-sort={active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}>
        <button className={`th-sort ${active ? 'active' : ''}`} onClick={() => onSort?.(c.key)}>
          {c.label}
          {active && (sortDir === 'asc' ? <ArrowUpIcon size={12} /> : <ArrowDownIcon size={12} />)}
        </button>
      </th>
    );
  };

  return (
    <div className="table-wrap">
      <table className="table leaderboard-table">
        <thead>
          <tr>{COLUMNS.map(header)}</tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.playerId} className={MEDALS[r.rank] ? `row-${MEDALS[r.rank]}` : ''}>
              <td data-label="Rank">
                <div className="rank-cell">
                  <span className={`rank-pill ${MEDALS[r.rank] ? `rank-${MEDALS[r.rank]}` : ''}`}>{r.rank}</span>
                  <RankMovement movement={r.movement} previousRank={r.previousRank} />
                </div>
              </td>
              <td data-label="Player" className="player-cell">
                <Link to={`/players/${r.playerId}`} className="player-link">
                  <Avatar name={r.fullName} url={r.photoUrl} size={36} />
                  <span>
                    <strong>{r.fullName}</strong>
                    <SkillBadge level={r.skillLevel} />
                    <small className="mobile-stats">
                      {r.wins}W–{r.losses}L · {formatPct(r.winPercentage)}
                      {r.currentWinStreak > 1 && <> · 🔥{r.currentWinStreak}</>}
                    </small>
                  </span>
                </Link>
              </td>
              <td data-label="Played" className="num">{r.matchesPlayed}</td>
              <td data-label="Wins" className="num win">{r.wins}</td>
              <td data-label="Losses" className="num loss">{r.losses}</td>
              <td data-label="Win %" className="num">{formatPct(r.winPercentage)}</td>
              <td data-label="Points" className="num points">{r.points}</td>
              <td data-label="Streak" className="num">
                {r.currentWinStreak > 0 ? (
                  <span className={`streak ${r.currentWinStreak >= 3 ? 'hot' : ''}`}>
                    <FlameIcon size={14} /> {r.currentWinStreak}
                  </span>
                ) : (
                  <span className="muted">0</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

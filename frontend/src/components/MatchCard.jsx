import { Link } from 'react-router-dom';
import { formatDateTime, label } from '../utils/format';
import { MapPinIcon } from './Icons';
import { Avatar, Badge } from './UI';

function Team({ players, won, decided }) {
  return (
    <div className={`mc-team ${decided ? (won ? 'won' : 'lost') : ''}`}>
      {players.map((p) => (
        <Link key={p.playerId} to={`/players/${p.playerId}`} className="mc-player">
          <Avatar name={p.fullName} url={p.photoUrl} size={30} />
          <span>{p.fullName}</span>
        </Link>
      ))}
    </div>
  );
}

const STATUS_TONE = { Completed: 'green', Scheduled: 'info', Cancelled: 'red' };

export default function MatchCard({ match, perspective, actions, compact = false }) {
  const r = match.result;
  const decided = Boolean(r);
  let outcome = null;
  if (perspective && r) {
    const team = match.team1.some((p) => p.playerId === perspective) ? 1 : 2;
    outcome = r.winningTeam === team ? 'W' : 'L';
  }

  return (
    <article className={`match-card ${compact ? 'compact' : ''} ${match.status === 'Cancelled' ? 'cancelled' : ''}`}>
      <header className="mc-head">
        <div className="mc-tags">
          {outcome && <span className={`outcome outcome-${outcome}`}>{outcome}</span>}
          <Badge tone="outline">{match.matchType}</Badge>
          {match.category !== 'Open' && <Badge tone="outline">{label(match.category)}</Badge>}
          {match.status !== 'Completed' && <Badge tone={STATUS_TONE[match.status]}>{match.status}</Badge>}
        </div>
        <Link to={`/matches/${match.id}`} className="mc-date">
          {formatDateTime(match.playedAt)}
        </Link>
      </header>

      <div className="mc-body">
        <Team players={match.team1} won={r?.winningTeam === 1} decided={decided} />
        <div className="mc-score">
          {r ? (
            <>
              <span className={r.winningTeam === 1 ? 'win' : ''}>{r.team1Score}</span>
              <span className="dash">–</span>
              <span className={r.winningTeam === 2 ? 'win' : ''}>{r.team2Score}</span>
            </>
          ) : (
            <span className="vs">VS</span>
          )}
        </div>
        <Team players={match.team2} won={r?.winningTeam === 2} decided={decided} />
      </div>

      {(match.location || actions) && (
        <footer className="mc-foot">
          {match.location ? (
            <span className="muted mc-loc">
              <MapPinIcon size={14} /> {match.location}
            </span>
          ) : (
            <span />
          )}
          {actions && <div className="mc-actions">{actions}</div>}
        </footer>
      )}
    </article>
  );
}

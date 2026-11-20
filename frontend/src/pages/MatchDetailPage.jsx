import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { matchesApi } from '../api';
import MatchCard from '../components/MatchCard';
import { HistoryIcon } from '../components/Icons';
import { ErrorBanner, Loader } from '../components/UI';
import { useAuth } from '../context/AuthContext';
import { formatDateTime, label } from '../utils/format';

function describe(snapshot) {
  if (!snapshot) return '—';
  const names = (team) => (team || []).map((p) => p.name || `#${p.playerId}`).join(' & ');
  const score = snapshot.result ? `${snapshot.result.team1Score}–${snapshot.result.team2Score}` : 'no result';
  return `${names(snapshot.team1)} vs ${names(snapshot.team2)} · ${score} · ${snapshot.matchType}, ${label(snapshot.category)} · ${snapshot.status}`;
}

export default function MatchDetailPage() {
  const { id } = useParams();
  const { isAdmin } = useAuth();
  const [match, setMatch] = useState(null);
  const [history, setHistory] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    setError(null);
    matchesApi.get(id).then(setMatch).catch(setError);
    if (isAdmin) matchesApi.history(id).then(setHistory).catch(() => setHistory([]));
  }, [id, isAdmin]);

  if (error) return <div className="container page"><ErrorBanner error={error} /></div>;
  if (!match) return <Loader />;

  return (
    <div className="container page narrow">
      <Link to="/matches" className="back-link">← All matches</Link>
      <h1>Match #{match.id}</h1>
      <MatchCard match={match} />
      {match.notes && (
        <section className="card">
          <h2>Notes</h2>
          <p>{match.notes}</p>
        </section>
      )}

      {isAdmin && (
        <section className="card">
          <div className="card-head">
            <h2><HistoryIcon /> Change history</h2>
            <Link to="/admin/matches" className="btn btn-sm btn-ghost">Edit in admin</Link>
          </div>
          {!history ? (
            <Loader />
          ) : history.length === 0 ? (
            <p className="muted">No changes recorded.</p>
          ) : (
            <ol className="timeline">
              {history.map((h) => (
                <li key={h.id}>
                  <div className="timeline-head">
                    <strong>{label(h.action)}</strong>
                    <span className="muted">
                      {formatDateTime(h.changedAt)} · {h.changedBy}
                    </span>
                  </div>
                  {h.reason && <p className="timeline-reason">“{h.reason}”</p>}
                  {h.previousValues && <p className="diff diff-old">Before: {describe(h.previousValues)}</p>}
                  {h.newValues && <p className="diff diff-new">After: {describe(h.newValues)}</p>}
                </li>
              ))}
            </ol>
          )}
        </section>
      )}
    </div>
  );
}

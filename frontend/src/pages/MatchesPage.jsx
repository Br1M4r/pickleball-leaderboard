import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { matchesApi } from '../api';
import MatchCard from '../components/MatchCard';
import { EmptyState, ErrorBanner, Loader, Pagination } from '../components/UI';
import { useAuth } from '../context/AuthContext';
import { MATCH_CATEGORIES, MATCH_TYPES } from '../utils/format';

export default function MatchesPage() {
  const { isAdmin } = useAuth();
  const [filters, setFilters] = useState({ status: 'Completed', matchType: '', category: '' });
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    setError(null);
    matchesApi
      .list({ ...filters, page, pageSize: 12 })
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(e));
    return () => {
      alive = false;
    };
  }, [filters, page]);

  const set = (k) => (e) => {
    setPage(1);
    setFilters((f) => ({ ...f, [k]: e.target.value }));
  };

  return (
    <div className="container page">
      <div className="page-head">
        <div>
          <h1>Matches</h1>
          <p className="muted">Results and upcoming fixtures.</p>
        </div>
        {isAdmin && <Link to="/admin/matches" className="btn btn-primary">Manage matches</Link>}
      </div>

      <div className="toolbar">
        <select value={filters.status} onChange={set('status')} aria-label="Status">
          <option value="Completed">Results</option>
          <option value="Scheduled">Upcoming</option>
          <option value="">All</option>
        </select>
        <select value={filters.matchType} onChange={set('matchType')} aria-label="Match type">
          <option value="">Singles & doubles</option>
          {MATCH_TYPES.map((t) => <option key={t}>{t}</option>)}
        </select>
        <select value={filters.category} onChange={set('category')} aria-label="Category">
          <option value="">All categories</option>
          {MATCH_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
      </div>

      <ErrorBanner error={error} />
      {!data ? (
        <Loader />
      ) : data.items.length === 0 ? (
        <EmptyState title="No matches found">Try a different filter.</EmptyState>
      ) : (
        <>
          <div className="match-grid">
            {data.items.map((m) => <MatchCard key={m.id} match={m} />)}
          </div>
          <Pagination page={data.page} totalPages={data.totalPages} onChange={setPage} />
        </>
      )}
    </div>
  );
}

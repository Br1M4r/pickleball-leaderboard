import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { playersApi } from '../api';
import { SearchIcon } from '../components/Icons';
import { Avatar, Badge, EmptyState, ErrorBanner, Loader, Pagination, SkillBadge, useDebounced } from '../components/UI';
import { GENDERS, SKILL_LEVELS, formatDate } from '../utils/format';

export default function PlayersPage() {
  const [search, setSearch] = useState('');
  const [gender, setGender] = useState('');
  const [skillLevel, setSkillLevel] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const q = useDebounced(search);

  useEffect(() => setPage(1), [q, gender, skillLevel]);

  useEffect(() => {
    let alive = true;
    playersApi
      .list({ search: q, gender, skillLevel, page, pageSize: 24 })
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(e));
    return () => {
      alive = false;
    };
  }, [q, gender, skillLevel, page]);

  return (
    <div className="container page">
      <div className="page-head">
        <div>
          <h1>Players</h1>
          <p className="muted">{data ? `${data.totalCount} registered players` : ' '}</p>
        </div>
      </div>

      <div className="toolbar">
        <label className="search">
          <SearchIcon />
          <input type="search" placeholder="Search by name…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </label>
        <select value={gender} onChange={(e) => setGender(e.target.value)} aria-label="Gender">
          <option value="">All genders</option>
          {GENDERS.map((g) => <option key={g}>{g}</option>)}
        </select>
        <select value={skillLevel} onChange={(e) => setSkillLevel(e.target.value)} aria-label="Skill level">
          <option value="">All skill levels</option>
          {SKILL_LEVELS.map((s) => <option key={s}>{s}</option>)}
        </select>
      </div>

      <ErrorBanner error={error} />
      {!data ? (
        <Loader />
      ) : data.items.length === 0 ? (
        <EmptyState title="No players found" />
      ) : (
        <>
          <div className="player-grid">
            {data.items.map((p) => (
              <Link key={p.id} to={`/players/${p.id}`} className="player-card">
                <Avatar name={p.fullName} url={p.photoUrl} size={64} />
                <h3>{p.fullName}</h3>
                <div className="profile-tags">
                  <SkillBadge level={p.skillLevel} />
                  <Badge tone="outline">{p.playingCategory}</Badge>
                </div>
                <span className="muted small">Joined {formatDate(p.dateRegistered)}</span>
              </Link>
            ))}
          </div>
          <Pagination page={data.page} totalPages={data.totalPages} onChange={setPage} />
        </>
      )}
    </div>
  );
}

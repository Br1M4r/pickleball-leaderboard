import { useCallback, useEffect, useState } from 'react';
import { leaderboardApi, rulesApi } from '../api';
import { LeaderboardTable, Podium } from '../components/Leaderboard';
import { SearchIcon } from '../components/Icons';
import { EmptyState, ErrorBanner, Loader, useDebounced } from '../components/UI';
import { SCOPES, SKILL_LEVELS, formatDateTime } from '../utils/format';

const DEFAULT_DIR = { rank: 'asc', name: 'asc' };

export default function LeaderboardPage() {
  const [scope, setScope] = useState('Overall');
  const [skillLevel, setSkillLevel] = useState('');
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState('rank');
  const [sortDir, setSortDir] = useState('asc');
  const [data, setData] = useState(null);
  const [rules, setRules] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const debouncedSearch = useDebounced(search);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await leaderboardApi.get({ scope, skillLevel, search: debouncedSearch, sortBy, sortDir }));
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, [scope, skillLevel, debouncedSearch, sortBy, sortDir]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    rulesApi.get().then(setRules).catch(() => {});
  }, []);

  const onSort = (key) => {
    if (key === sortBy) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortBy(key);
      setSortDir(DEFAULT_DIR[key] || 'desc');
    }
  };

  const rows = data?.rows ?? [];
  const showPodium = !debouncedSearch && !skillLevel && sortBy === 'rank' && sortDir === 'asc' && rows.length > 0;

  return (
    <>
      <section className="hero">
        <div className="container hero-inner">
          <div>
            <p className="eyebrow">Live rankings</p>
            <h1>League Leaderboard</h1>
            <p className="hero-sub">
              {data?.totalRanked ?? 0} ranked players
              {data?.lastUpdated && <> · updated {formatDateTime(data.lastUpdated)}</>}
            </p>
          </div>
          <div className="court-lines" aria-hidden="true" />
        </div>
      </section>

      <div className="container page">
        <div className="scope-tabs" role="tablist" aria-label="Ranking category">
          {SCOPES.map((s) => (
            <button
              key={s.value}
              role="tab"
              aria-selected={scope === s.value}
              className={scope === s.value ? 'active' : ''}
              onClick={() => setScope(s.value)}
            >
              {s.label}
            </button>
          ))}
        </div>

        <div className="toolbar">
          <label className="search">
            <SearchIcon />
            <input
              type="search"
              placeholder="Search players…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search players"
            />
          </label>
          <select value={skillLevel} onChange={(e) => setSkillLevel(e.target.value)} aria-label="Skill level">
            <option value="">All skill levels</option>
            {SKILL_LEVELS.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <select
            className="mobile-only"
            value={`${sortBy}:${sortDir}`}
            onChange={(e) => {
              const [k, d] = e.target.value.split(':');
              setSortBy(k);
              setSortDir(d);
            }}
            aria-label="Sort by"
          >
            <option value="rank:asc">Sort: Rank</option>
            <option value="points:desc">Sort: Points</option>
            <option value="wins:desc">Sort: Wins</option>
            <option value="winPercentage:desc">Sort: Win %</option>
            <option value="streak:desc">Sort: Streak</option>
            <option value="name:asc">Sort: Name</option>
          </select>
        </div>

        <ErrorBanner error={error} onRetry={load} />

        {loading && !data ? (
          <Loader text="Loading rankings…" />
        ) : rows.length === 0 ? (
          <EmptyState title="No ranked players yet">
            {debouncedSearch || skillLevel
              ? 'No players match your filters.'
              : 'Rankings appear here as soon as match results are recorded in this category.'}
          </EmptyState>
        ) : (
          <div className={loading ? 'is-refreshing' : ''}>
            {showPodium && <Podium rows={rows} />}
            <LeaderboardTable rows={rows} sortBy={sortBy} sortDir={sortDir} onSort={onSort} />
          </div>
        )}

        {rules && (
          <aside className="card rules-card">
            <h2>How points are earned</h2>
            <ul>
              <li><strong>+{rules.winPoints}</strong> for every win</li>
              <li>
                <strong>{rules.lossPoints >= 0 ? `+${rules.lossPoints}` : rules.lossPoints}</strong> for a loss
                {!rules.allowNegativePoints && rules.lossPoints < 0 && ' (never below 0)'}
              </li>
              {rules.marginBonusThreshold > 0 && rules.marginBonusPoints > 0 && (
                <li><strong>+{rules.marginBonusPoints}</strong> bonus for winning by {rules.marginBonusThreshold}+ points</li>
              )}
              {rules.streakBonusThreshold > 0 && rules.streakBonusPoints > 0 && (
                <li><strong>+{rules.streakBonusPoints}</strong> bonus for every {rules.streakBonusThreshold} consecutive wins</li>
              )}
              <li>Minimum {rules.minMatchesToRank} match{rules.minMatchesToRank === 1 ? '' : 'es'} to be ranked</li>
              <li className="muted">Ties are broken by win %, then wins, then point differential.</li>
            </ul>
          </aside>
        )}
      </div>
    </>
  );
}

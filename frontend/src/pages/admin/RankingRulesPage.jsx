import { useEffect, useState } from 'react';
import { rulesApi } from '../../api';
import { ErrorBanner, Loader } from '../../components/UI';
import { useToast } from '../../context/ToastContext';
import { formatDateTime } from '../../utils/format';

const FIELDS = [
  { key: 'winPoints', label: 'Points per win', min: 0, max: 100, help: 'Awarded to every player on the winning side.' },
  { key: 'lossPoints', label: 'Points per loss', min: -100, max: 100, help: 'Use a negative number to deduct points for a loss.' },
  { key: 'marginBonusThreshold', label: 'Margin bonus: win by at least', min: 0, max: 99, help: 'Point margin needed for the bonus. 0 disables it.' },
  { key: 'marginBonusPoints', label: 'Margin bonus points', min: 0, max: 100 },
  { key: 'streakBonusThreshold', label: 'Streak bonus: every N consecutive wins', min: 0, max: 50, help: 'e.g. 3 = bonus on the 3rd, 6th, 9th… win in a row. 0 disables it.' },
  { key: 'streakBonusPoints', label: 'Streak bonus points', min: 0, max: 100 },
  { key: 'minMatchesToRank', label: 'Minimum matches to be ranked', min: 1, max: 100 },
];

export default function RankingRulesPage() {
  const toast = useToast();
  const [rules, setRules] = useState(null);
  const [form, setForm] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    rulesApi.get().then((r) => { setRules(r); setForm(r); }).catch(setError);
  }, []);

  if (error && !form) return <ErrorBanner error={error} />;
  if (!form) return <Loader />;

  const set = (k) => (e) =>
    setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    if (!window.confirm('Save rules and recalculate every ranking from the full match history?')) return;
    setBusy(true);
    setError(null);
    try {
      const payload = { name: form.name, allowNegativePoints: form.allowNegativePoints };
      FIELDS.forEach((f) => { payload[f.key] = Number(form[f.key]); });
      const saved = await rulesApi.update(payload);
      setRules(saved);
      setForm(saved);
      toast.success('Ranking rules saved — all rankings recalculated.');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  // Simple preview: a player who wins 3 in a row by a big margin.
  const n = (k) => Number(form[k]) || 0;
  const preview =
    3 * n('winPoints') +
    (n('marginBonusThreshold') > 0 ? 3 * n('marginBonusPoints') : 0) +
    (n('streakBonusThreshold') > 0 ? Math.floor(3 / n('streakBonusThreshold')) * n('streakBonusPoints') : 0);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Ranking rules</h1>
          <p className="muted">Last changed {formatDateTime(rules.updatedAt)}. Saving rebuilds every leaderboard.</p>
        </div>
      </div>

      <div className="two-col">
        <form className="card form-grid" onSubmit={submit}>
          <ErrorBanner error={error} />
          <label className="field span-2">
            <span>Rule set name</span>
            <input required maxLength={80} value={form.name} onChange={set('name')} />
          </label>
          {FIELDS.map((f) => (
            <label key={f.key} className="field">
              <span>{f.label}</span>
              <input type="number" required min={f.min} max={f.max} value={form[f.key]} onChange={set(f.key)} />
              {f.help && <small className="muted">{f.help}</small>}
            </label>
          ))}
          <label className="check span-2">
            <input type="checkbox" checked={form.allowNegativePoints} onChange={set('allowNegativePoints')} />
            <span>Allow total points to go below zero</span>
          </label>
          <div className="span-2">
            <button className="btn btn-primary" disabled={busy}>{busy ? 'Recalculating…' : 'Save & recalculate'}</button>
          </div>
        </form>

        <aside className="card">
          <h2>How ranking works</h2>
          <ol className="explain">
            <li>Every completed, non-cancelled match is replayed in date order.</li>
            <li>Each player on the winning side earns the win points plus any bonuses; losers receive the loss points.</li>
            <li>Players are ordered by <b>points</b>, then <b>win %</b>, then <b>wins</b>, then <b>point differential</b>. Fully tied players share a rank.</li>
            <li>Rankings are kept separately for Overall, Singles, Doubles, Men’s, Women’s and Mixed Doubles.</li>
            <li>Editing or correcting any result rebuilds all rankings, so the standings are always consistent.</li>
          </ol>
          <div className="preview">
            <span className="muted">Example: 3 straight wins by a wide margin</span>
            <strong>{preview} pts</strong>
          </div>
        </aside>
      </div>
    </>
  );
}

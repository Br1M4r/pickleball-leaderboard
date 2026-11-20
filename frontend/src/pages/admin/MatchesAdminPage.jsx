import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { matchesApi, playersApi } from '../../api';
import MatchCard from '../../components/MatchCard';
import { EditIcon, HistoryIcon, PlusIcon } from '../../components/Icons';
import { EmptyState, ErrorBanner, Loader, Modal, Pagination } from '../../components/UI';
import { useToast } from '../../context/ToastContext';
import { MATCH_CATEGORIES, MATCH_TYPES, fromLocalInput, toLocalInput } from '../../utils/format';

// ------------------------------------------------------------------ match form

function emptyForm() {
  return {
    matchType: 'Singles',
    category: 'Open',
    playedAt: toLocalInput(),
    location: '',
    notes: '',
    team1: ['', ''],
    team2: ['', ''],
    withResult: true,
    team1Score: '',
    team2Score: '',
    reason: '',
  };
}

function formFromMatch(m) {
  const ids = (team) => [team[0]?.playerId ?? '', team[1]?.playerId ?? ''];
  return {
    matchType: m.matchType,
    category: m.category,
    playedAt: toLocalInput(m.playedAt),
    location: m.location ?? '',
    notes: m.notes ?? '',
    team1: ids(m.team1),
    team2: ids(m.team2),
    withResult: false,
    team1Score: '',
    team2Score: '',
    reason: '',
  };
}

function allowedFor(category, slotGender) {
  // Client-side hint only; the API enforces the same rules.
  if (category === 'Mens') return slotGender === 'Male';
  if (category === 'Womens') return slotGender === 'Female';
  return true;
}

function MatchFormModal({ open, match, players, onClose, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const editing = Boolean(match);
  const hasResult = Boolean(match?.result);

  useEffect(() => {
    if (open) {
      setForm(match ? formFromMatch(match) : emptyForm());
      setError(null);
    }
  }, [open, match]);

  const size = form.matchType === 'Singles' ? 1 : 2;
  const selected = [...form.team1.slice(0, size), ...form.team2.slice(0, size)].filter(Boolean).map(Number);
  const existingIds = useMemo(
    () => new Set(match ? [...match.team1, ...match.team2].map((p) => p.playerId) : []),
    [match],
  );

  const options = (current) =>
    players.filter(
      (p) =>
        (p.isActive || existingIds.has(p.id)) &&
        allowedFor(form.category, p.gender) &&
        (!selected.includes(p.id) || p.id === Number(current)),
    );

  const set = (k) => (e) => {
    const value = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    setForm((f) => {
      const next = { ...f, [k]: value };
      if (k === 'matchType' && value === 'Singles' && f.category === 'Mixed') next.category = 'Open';
      return next;
    });
  };
  const setSlot = (team, idx) => (e) =>
    setForm((f) => {
      const arr = [...f[team]];
      arr[idx] = e.target.value;
      return { ...f, [team]: arr };
    });

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    const team1PlayerIds = form.team1.slice(0, size).map(Number);
    const team2PlayerIds = form.team2.slice(0, size).map(Number);
    if ([...team1PlayerIds, ...team2PlayerIds].some((x) => !x)) {
      setError('Select every player slot.');
      return;
    }
    const payload = {
      matchType: form.matchType,
      category: form.category,
      playedAt: fromLocalInput(form.playedAt),
      location: form.location,
      notes: form.notes,
      team1PlayerIds,
      team2PlayerIds,
      reason: form.reason || null,
      result:
        form.withResult && !hasResult
          ? { team1Score: Number(form.team1Score), team2Score: Number(form.team2Score) }
          : null,
    };
    if (payload.result && payload.result.team1Score === payload.result.team2Score) {
      setError('Scores cannot be tied.');
      return;
    }

    setBusy(true);
    try {
      const saved = editing ? await matchesApi.update(match.id, payload) : await matchesApi.create(payload);
      toast.success(editing ? 'Match updated.' : payload.result ? 'Match recorded — rankings updated.' : 'Match scheduled.');
      onSaved(saved);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const slot = (team, idx, labelText) => (
    <label className="field" key={`${team}${idx}`}>
      <span>{labelText}</span>
      <select required value={form[team][idx]} onChange={setSlot(team, idx)}>
        <option value="">Select player…</option>
        {options(form[team][idx]).map((p) => (
          <option key={p.id} value={p.id}>
            {p.fullName} · {p.gender[0]} · {p.skillLevel}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title={editing ? `Edit match #${match.id}` : 'New match'}
      footer={
        <>
          <button className="btn btn-ghost" type="button" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" form="match-form" disabled={busy}>
            {busy ? 'Saving…' : editing ? 'Save changes' : 'Save match'}
          </button>
        </>
      }
    >
      <form id="match-form" onSubmit={submit} className="form-grid">
        <ErrorBanner error={error} />
        <label className="field">
          <span>Match type</span>
          <select value={form.matchType} onChange={set('matchType')}>
            {MATCH_TYPES.map((t) => <option key={t}>{t}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Category</span>
          <select value={form.category} onChange={set('category')}>
            {MATCH_CATEGORIES.filter((c) => c.value !== 'Mixed' || form.matchType === 'Doubles').map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Date & time played</span>
          <input type="datetime-local" required value={form.playedAt} onChange={set('playedAt')} />
        </label>
        <label className="field">
          <span>Location / court</span>
          <input maxLength={150} value={form.location} onChange={set('location')} placeholder="e.g. Court 2" />
        </label>

        <fieldset className="team-box">
          <legend>Team 1</legend>
          {slot('team1', 0, size === 1 ? 'Player' : 'Player 1')}
          {size === 2 && slot('team1', 1, 'Player 2')}
        </fieldset>
        <fieldset className="team-box">
          <legend>Team 2</legend>
          {slot('team2', 0, size === 1 ? 'Player' : 'Player 1')}
          {size === 2 && slot('team2', 1, 'Player 2')}
        </fieldset>
        {form.category === 'Mixed' && (
          <p className="muted small span-2">Mixed doubles: each team needs one male and one female player.</p>
        )}

        {!hasResult && (
          <div className="span-2 result-box">
            <label className="check">
              <input type="checkbox" checked={form.withResult} onChange={set('withResult')} />
              <span>Record the final score now</span>
            </label>
            {form.withResult && (
              <div className="score-inputs">
                <label className="field">
                  <span>Team 1 score</span>
                  <input type="number" min={0} max={99} required value={form.team1Score} onChange={set('team1Score')} />
                </label>
                <span className="dash">–</span>
                <label className="field">
                  <span>Team 2 score</span>
                  <input type="number" min={0} max={99} required value={form.team2Score} onChange={set('team2Score')} />
                </label>
              </div>
            )}
          </div>
        )}

        <label className="field span-2">
          <span>Notes</span>
          <textarea rows={2} maxLength={1000} value={form.notes} onChange={set('notes')} />
        </label>

        {hasResult && (
          <label className="field span-2">
            <span>Reason for change (required — logged in match history)</span>
            <input required maxLength={500} value={form.reason} onChange={set('reason')} />
          </label>
        )}
      </form>
    </Modal>
  );
}

// ------------------------------------------------------------------ result modal

function ResultModal({ match, onClose, onSaved }) {
  const toast = useToast();
  const correcting = Boolean(match?.result);
  const [t1, setT1] = useState('');
  const [t2, setT2] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setT1(match?.result?.team1Score ?? '');
    setT2(match?.result?.team2Score ?? '');
    setReason('');
    setError(null);
  }, [match]);

  if (!match) return null;
  const names = (team) => team.map((p) => p.fullName).join(' & ');

  const submit = async (e) => {
    e.preventDefault();
    if (Number(t1) === Number(t2)) {
      setError('Scores cannot be tied.');
      return;
    }
    setBusy(true);
    try {
      const saved = await matchesApi.recordResult(match.id, {
        team1Score: Number(t1),
        team2Score: Number(t2),
        reason: reason || null,
      });
      toast.success(correcting ? 'Result corrected — rankings recalculated.' : 'Result recorded — rankings updated.');
      onSaved(saved);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={correcting ? 'Correct result' : 'Record result'}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" form="result-form" disabled={busy}>{busy ? 'Saving…' : 'Save result'}</button>
        </>
      }
    >
      <form id="result-form" onSubmit={submit} className="form-grid">
        <ErrorBanner error={error} />
        <div className="score-inputs span-2">
          <label className="field">
            <span>{names(match.team1)}</span>
            <input type="number" min={0} max={99} required value={t1} onChange={(e) => setT1(e.target.value)} />
          </label>
          <span className="dash">–</span>
          <label className="field">
            <span>{names(match.team2)}</span>
            <input type="number" min={0} max={99} required value={t2} onChange={(e) => setT2(e.target.value)} />
          </label>
        </div>
        {correcting && (
          <label className="field span-2">
            <span>Reason for correction (required)</span>
            <input required maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Scores entered in reverse" />
          </label>
        )}
      </form>
    </Modal>
  );
}

// ------------------------------------------------------------------ reason modal (cancel/restore)

function ReasonModal({ action, onClose, onDone }) {
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    setReason('');
    setError(null);
  }, [action]);

  if (!action) return null;
  const { type, match } = action;
  const required = type === 'cancel' && Boolean(match.result);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const saved = type === 'cancel' ? await matchesApi.cancel(match.id, reason) : await matchesApi.restore(match.id, reason);
      toast.success(type === 'cancel' ? 'Match cancelled.' : 'Match restored.');
      onDone(saved);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={type === 'cancel' ? `Cancel match #${match.id}?` : `Restore match #${match.id}?`}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>Back</button>
          <button className={`btn ${type === 'cancel' ? 'btn-danger' : 'btn-primary'}`} form="reason-form" disabled={busy}>
            {type === 'cancel' ? 'Cancel match' : 'Restore match'}
          </button>
        </>
      }
    >
      <form id="reason-form" onSubmit={submit} className="form-grid">
        <ErrorBanner error={error} />
        <p className="span-2 muted">
          {type === 'cancel'
            ? 'Cancelled matches are excluded from rankings. This is logged and can be undone.'
            : 'The match will count toward rankings again if it has a result.'}
        </p>
        <label className="field span-2">
          <span>Reason {required ? '(required)' : '(optional)'}</span>
          <input required={required} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
      </form>
    </Modal>
  );
}

// ------------------------------------------------------------------ page

export default function MatchesAdminPage() {
  const [params, setParams] = useSearchParams();
  const [filters, setFilters] = useState({ status: '', matchType: '', category: '' });
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [players, setPlayers] = useState([]);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [resultFor, setResultFor] = useState(null);
  const [reasonAction, setReasonAction] = useState(null);

  const load = useCallback(() => {
    setError(null);
    matchesApi.list({ ...filters, page, pageSize: 12 }).then(setData).catch(setError);
  }, [filters, page]);

  useEffect(load, [load]);

  useEffect(() => {
    playersApi.all({ includeInactive: true }).then(setPlayers).catch(() => {});
  }, []);

  useEffect(() => {
    if (params.get('new')) {
      setEditing(null);
      setFormOpen(true);
      params.delete('new');
      setParams(params, { replace: true });
    }
  }, [params, setParams]);

  const afterSave = () => {
    setFormOpen(false);
    setEditing(null);
    setResultFor(null);
    setReasonAction(null);
    load();
  };

  const set = (k) => (e) => {
    setPage(1);
    setFilters((f) => ({ ...f, [k]: e.target.value }));
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Matches</h1>
          <p className="muted">Create matches, record scores and correct results. Every change is audited.</p>
        </div>
        <button className="btn btn-primary" onClick={() => { setEditing(null); setFormOpen(true); }}>
          <PlusIcon size={16} /> New match
        </button>
      </div>

      <div className="toolbar">
        <select value={filters.status} onChange={set('status')} aria-label="Status">
          <option value="">Active (all)</option>
          <option value="Completed">Completed</option>
          <option value="Scheduled">Scheduled</option>
          <option value="Cancelled">Cancelled</option>
        </select>
        <select value={filters.matchType} onChange={set('matchType')} aria-label="Type">
          <option value="">All types</option>
          {MATCH_TYPES.map((t) => <option key={t}>{t}</option>)}
        </select>
        <select value={filters.category} onChange={set('category')} aria-label="Category">
          <option value="">All categories</option>
          {MATCH_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
      </div>

      <ErrorBanner error={error} onRetry={load} />
      {!data ? (
        <Loader />
      ) : data.items.length === 0 ? (
        <EmptyState title="No matches here yet" action={<button className="btn btn-primary" onClick={() => setFormOpen(true)}>Create a match</button>} />
      ) : (
        <>
          <div className="match-grid">
            {data.items.map((m) => (
              <MatchCard
                key={m.id}
                match={m}
                actions={
                  <>
                    {m.status !== 'Cancelled' && (
                      <button className="btn btn-sm btn-primary" onClick={() => setResultFor(m)}>
                        {m.result ? 'Correct score' : 'Record score'}
                      </button>
                    )}
                    {m.status !== 'Cancelled' && (
                      <button className="icon-btn" title="Edit" onClick={() => { setEditing(m); setFormOpen(true); }}>
                        <EditIcon size={16} />
                      </button>
                    )}
                    <Link className="icon-btn" title="History" to={`/matches/${m.id}`}>
                      <HistoryIcon size={16} />
                    </Link>
                    {m.status === 'Cancelled' ? (
                      <button className="btn btn-sm btn-ghost" onClick={() => setReasonAction({ type: 'restore', match: m })}>Restore</button>
                    ) : (
                      <button className="btn btn-sm btn-ghost danger" onClick={() => setReasonAction({ type: 'cancel', match: m })}>Cancel</button>
                    )}
                  </>
                }
              />
            ))}
          </div>
          <Pagination page={data.page} totalPages={data.totalPages} onChange={setPage} />
        </>
      )}

      <MatchFormModal
        open={formOpen}
        match={editing}
        players={players}
        onClose={() => { setFormOpen(false); setEditing(null); }}
        onSaved={afterSave}
      />
      <ResultModal match={resultFor} onClose={() => setResultFor(null)} onSaved={afterSave} />
      <ReasonModal action={reasonAction} onClose={() => setReasonAction(null)} onDone={afterSave} />
    </>
  );
}

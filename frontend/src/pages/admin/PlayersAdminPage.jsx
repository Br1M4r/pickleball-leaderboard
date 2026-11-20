import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { playersApi } from '../../api';
import PlayerFields from '../../components/PlayerFields';
import { CameraIcon, EditIcon, PlusIcon, SearchIcon } from '../../components/Icons';
import { Avatar, Badge, EmptyState, ErrorBanner, Loader, Modal, Pagination, SkillBadge, useDebounced } from '../../components/UI';
import { useToast } from '../../context/ToastContext';
import { GENDERS, SKILL_LEVELS, formatDate } from '../../utils/format';

const EMPTY = { fullName: '', gender: '', age: '', skillLevel: 'Beginner', playingCategory: 'Both', email: '', password: '' };

function PlayerModal({ open, player, onClose, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState(EMPTY);
  const [current, setCurrent] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);
  const editing = Boolean(player);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setCurrent(player);
    setForm(player ? { ...EMPTY, ...player, email: '', password: '' } : EMPTY);
  }, [open, player]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const profile = {
      fullName: form.fullName,
      gender: form.gender,
      age: Number(form.age),
      skillLevel: form.skillLevel,
      playingCategory: form.playingCategory,
    };
    try {
      const saved = editing
        ? await playersApi.update(player.id, profile)
        : await playersApi.create({ ...profile, email: form.email || null, password: form.password || null });
      toast.success(editing ? 'Player updated.' : 'Player registered.');
      onSaved(saved);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const upload = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const updated = await playersApi.uploadPhoto(current.id, file);
      setCurrent(updated);
      toast.success('Photo updated.');
    } catch (err) {
      toast.error(err.message);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? `Edit ${player.fullName}` : 'Register player'}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" form="player-form" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        </>
      }
    >
      {editing && current && (
        <div className="photo-row">
          <Avatar name={current.fullName} url={current.photoUrl} size={72} />
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" hidden onChange={upload} />
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => fileRef.current?.click()}>
            <CameraIcon size={16} /> Change photo
          </button>
        </div>
      )}
      <form id="player-form" className="form-grid" onSubmit={submit}>
        <ErrorBanner error={error} />
        <PlayerFields form={form} set={set} />
        {!editing && (
          <>
            <p className="span-2 muted small">Optional: create a login so the player can view their own stats.</p>
            <label className="field">
              <span>Login email</span>
              <input type="email" value={form.email} onChange={set('email')} />
            </label>
            <label className="field">
              <span>Temporary password</span>
              <input type="text" minLength={8} value={form.password} onChange={set('password')} autoComplete="off" />
            </label>
          </>
        )}
        {editing && player.email && (
          <p className="span-2 muted small">Login: {player.email} — manage it under Accounts.</p>
        )}
      </form>
    </Modal>
  );
}

export default function PlayersAdminPage() {
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState('');
  const [gender, setGender] = useState('');
  const [skillLevel, setSkillLevel] = useState('');
  const [includeInactive, setIncludeInactive] = useState(true);
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [modal, setModal] = useState({ open: false, player: null });
  const q = useDebounced(search);

  const load = useCallback(() => {
    setError(null);
    playersApi
      .list({ search: q, gender, skillLevel, includeInactive, page, pageSize: 20 })
      .then(setData)
      .catch(setError);
  }, [q, gender, skillLevel, includeInactive, page]);

  useEffect(load, [load]);
  useEffect(() => setPage(1), [q, gender, skillLevel, includeInactive]);

  // Deep link from profile page: /admin/players?edit=12
  useEffect(() => {
    const editId = params.get('edit');
    if (!editId) return;
    playersApi.get(editId).then((d) => setModal({ open: true, player: d.player })).catch(() => {});
    params.delete('edit');
    setParams(params, { replace: true });
  }, [params, setParams]);

  const toggleActive = async (p) => {
    const verb = p.isActive ? 'Deactivate' : 'Reactivate';
    if (!window.confirm(`${verb} ${p.fullName}? ${p.isActive ? 'They will be removed from rankings and unable to sign in.' : ''}`)) return;
    try {
      await playersApi.setStatus(p.id, !p.isActive);
      toast.success(`${p.fullName} ${p.isActive ? 'deactivated' : 'reactivated'}.`);
      load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Players</h1>
          <p className="muted">Register, edit and deactivate players.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setModal({ open: true, player: null })}>
          <PlusIcon size={16} /> Register player
        </button>
      </div>

      <div className="toolbar">
        <label className="search">
          <SearchIcon />
          <input type="search" placeholder="Search name or email…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </label>
        <select value={gender} onChange={(e) => setGender(e.target.value)} aria-label="Gender">
          <option value="">All genders</option>
          {GENDERS.map((g) => <option key={g}>{g}</option>)}
        </select>
        <select value={skillLevel} onChange={(e) => setSkillLevel(e.target.value)} aria-label="Skill">
          <option value="">All skill levels</option>
          {SKILL_LEVELS.map((s) => <option key={s}>{s}</option>)}
        </select>
        <label className="check">
          <input type="checkbox" checked={includeInactive} onChange={(e) => setIncludeInactive(e.target.checked)} />
          <span>Show inactive</span>
        </label>
      </div>

      <ErrorBanner error={error} onRetry={load} />
      {!data ? (
        <Loader />
      ) : data.items.length === 0 ? (
        <EmptyState title="No players found" />
      ) : (
        <>
          <div className="table-wrap card flush">
            <table className="table">
              <thead>
                <tr>
                  <th>Player</th>
                  <th>Gender</th>
                  <th className="num">Age</th>
                  <th>Skill</th>
                  <th>Category</th>
                  <th>Login</th>
                  <th>Registered</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.items.map((p) => (
                  <tr key={p.id} className={p.isActive ? '' : 'row-muted'}>
                    <td data-label="Player">
                      <Link to={`/players/${p.id}`} className="player-link">
                        <Avatar name={p.fullName} url={p.photoUrl} size={32} />
                        <strong>{p.fullName}</strong>
                      </Link>
                    </td>
                    <td data-label="Gender">{p.gender}</td>
                    <td data-label="Age" className="num">{p.age}</td>
                    <td data-label="Skill"><SkillBadge level={p.skillLevel} /></td>
                    <td data-label="Category">{p.playingCategory}</td>
                    <td data-label="Login" className="small">{p.email || <span className="muted">—</span>}</td>
                    <td data-label="Registered">{formatDate(p.dateRegistered)}</td>
                    <td data-label="Status">
                      <Badge tone={p.isActive ? 'green' : 'red'}>{p.isActive ? 'Active' : 'Inactive'}</Badge>
                    </td>
                    <td className="row-actions">
                      <button className="icon-btn" title="Edit" onClick={() => setModal({ open: true, player: p })}>
                        <EditIcon size={16} />
                      </button>
                      <button className={`btn btn-sm btn-ghost ${p.isActive ? 'danger' : ''}`} onClick={() => toggleActive(p)}>
                        {p.isActive ? 'Deactivate' : 'Activate'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={data.page} totalPages={data.totalPages} onChange={setPage} />
        </>
      )}

      <PlayerModal
        open={modal.open}
        player={modal.player}
        onClose={() => { setModal({ open: false, player: null }); load(); }}
        onSaved={() => { setModal({ open: false, player: null }); load(); }}
      />
    </>
  );
}

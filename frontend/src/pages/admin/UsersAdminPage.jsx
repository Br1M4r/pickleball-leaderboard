import { useCallback, useEffect, useState } from 'react';
import { playersApi, usersApi } from '../../api';
import { EditIcon, PlusIcon, SearchIcon } from '../../components/Icons';
import { Badge, EmptyState, ErrorBanner, Loader, Modal, Pagination, useDebounced } from '../../components/UI';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { formatDateTime } from '../../utils/format';

function UserModal({ open, account, onClose, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState({});
  const [unlinked, setUnlinked] = useState([]);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const editing = Boolean(account);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setForm(
      account
        ? { email: account.email, role: account.role, isActive: account.isActive }
        : { email: '', password: '', role: 'Player', playerId: '' },
    );
    if (!account) {
      playersApi.all({ includeInactive: true }).then((ps) => setUnlinked(ps.filter((p) => !p.userId))).catch(() => {});
    }
  }, [open, account]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const saved = editing
        ? await usersApi.update(account.id, form)
        : await usersApi.create({ ...form, playerId: form.playerId ? Number(form.playerId) : null });
      toast.success(editing ? 'Account updated.' : 'Account created.');
      onSaved(saved);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? 'Edit account' : 'Create account'}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" form="user-form" disabled={busy}>Save</button>
        </>
      }
    >
      <form id="user-form" className="form-grid" onSubmit={submit}>
        <ErrorBanner error={error} />
        <label className="field span-2">
          <span>Email</span>
          <input type="email" required value={form.email || ''} onChange={set('email')} />
        </label>
        {!editing && (
          <label className="field span-2">
            <span>Temporary password</span>
            <input type="text" required minLength={8} value={form.password || ''} onChange={set('password')} autoComplete="off" />
          </label>
        )}
        <label className="field">
          <span>Role</span>
          <select value={form.role || 'Player'} onChange={set('role')}>
            <option>Player</option>
            <option>Admin</option>
          </select>
        </label>
        {editing ? (
          <label className="check field-inline">
            <input type="checkbox" checked={Boolean(form.isActive)} onChange={set('isActive')} />
            <span>Account active</span>
          </label>
        ) : (
          <label className="field">
            <span>Link to player (optional)</span>
            <select value={form.playerId || ''} onChange={set('playerId')}>
              <option value="">No player profile</option>
              {unlinked.map((p) => <option key={p.id} value={p.id}>{p.fullName}</option>)}
            </select>
          </label>
        )}
        {editing && account.playerName && (
          <p className="span-2 muted small">Deactivating this account also deactivates player “{account.playerName}”.</p>
        )}
      </form>
    </Modal>
  );
}

function ResetModal({ account, onClose }) {
  const toast = useToast();
  const [pw, setPw] = useState('');
  const [error, setError] = useState(null);
  useEffect(() => { setPw(''); setError(null); }, [account]);
  if (!account) return null;

  const submit = async (e) => {
    e.preventDefault();
    try {
      await usersApi.resetPassword(account.id, pw);
      toast.success(`Password reset for ${account.email}.`);
      onClose();
    } catch (err) {
      setError(err);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`Reset password · ${account.email}`}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" form="reset-form">Reset password</button>
        </>
      }
    >
      <form id="reset-form" className="form-grid" onSubmit={submit}>
        <ErrorBanner error={error} />
        <label className="field span-2">
          <span>New temporary password (min 8 characters)</span>
          <input type="text" required minLength={8} value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="off" />
        </label>
      </form>
    </Modal>
  );
}

export default function UsersAdminPage() {
  const { user } = useAuth();
  const [search, setSearch] = useState('');
  const [role, setRole] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [modal, setModal] = useState({ open: false, account: null });
  const [resetFor, setResetFor] = useState(null);
  const q = useDebounced(search);

  const load = useCallback(() => {
    setError(null);
    usersApi.list({ search: q, role, page, pageSize: 20 }).then(setData).catch(setError);
  }, [q, role, page]);

  useEffect(load, [load]);
  useEffect(() => setPage(1), [q, role]);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Accounts</h1>
          <p className="muted">Manage logins, roles and access.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setModal({ open: true, account: null })}>
          <PlusIcon size={16} /> Create account
        </button>
      </div>

      <div className="toolbar">
        <label className="search">
          <SearchIcon />
          <input type="search" placeholder="Search email or player…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </label>
        <select value={role} onChange={(e) => setRole(e.target.value)} aria-label="Role">
          <option value="">All roles</option>
          <option>Admin</option>
          <option>Player</option>
        </select>
      </div>

      <ErrorBanner error={error} onRetry={load} />
      {!data ? (
        <Loader />
      ) : data.items.length === 0 ? (
        <EmptyState title="No accounts found" />
      ) : (
        <>
          <div className="table-wrap card flush">
            <table className="table">
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Player</th>
                  <th>Status</th>
                  <th>Last sign-in</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.items.map((u) => (
                  <tr key={u.id} className={u.isActive ? '' : 'row-muted'}>
                    <td data-label="Email"><strong>{u.email}</strong> {u.id === user.id && <Badge tone="gold">You</Badge>}</td>
                    <td data-label="Role"><Badge tone={u.role === 'Admin' ? 'gold' : 'info'}>{u.role}</Badge></td>
                    <td data-label="Player">{u.playerName || <span className="muted">—</span>}</td>
                    <td data-label="Status"><Badge tone={u.isActive ? 'green' : 'red'}>{u.isActive ? 'Active' : 'Inactive'}</Badge></td>
                    <td data-label="Last sign-in">{formatDateTime(u.lastLoginAt)}</td>
                    <td className="row-actions">
                      <button className="icon-btn" title="Edit" onClick={() => setModal({ open: true, account: u })}><EditIcon size={16} /></button>
                      <button className="btn btn-sm btn-ghost" onClick={() => setResetFor(u)}>Reset password</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={data.page} totalPages={data.totalPages} onChange={setPage} />
        </>
      )}

      <UserModal
        open={modal.open}
        account={modal.account}
        onClose={() => setModal({ open: false, account: null })}
        onSaved={() => { setModal({ open: false, account: null }); load(); }}
      />
      <ResetModal account={resetFor} onClose={() => setResetFor(null)} />
    </>
  );
}

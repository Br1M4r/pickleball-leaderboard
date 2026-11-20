import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { BallLogo } from '../components/Icons';
import { ErrorBanner } from '../components/UI';
import PlayerFields from '../components/PlayerFields';
import { useAuth } from '../context/AuthContext';

const EMPTY = {
  fullName: '',
  gender: '',
  age: '',
  skillLevel: 'Beginner',
  playingCategory: 'Both',
  email: '',
  password: '',
  confirm: '',
};

export default function RegisterPage() {
  const { register, user } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to="/" replace />;

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    if (form.password !== form.confirm) {
      setError('Passwords do not match.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { confirm: _confirm, ...data } = form;
      const u = await register({ ...data, age: Number(data.age) });
      navigate(`/players/${u.playerId}`, { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-page">
      <form className="auth-card card wide" onSubmit={submit}>
        <BallLogo size={48} />
        <h1>Join the league</h1>
        <p className="muted">Create your player profile to appear on the leaderboard.</p>
        <ErrorBanner error={error} />

        <div className="form-grid">
          <PlayerFields form={form} set={set} />
          <label className="field span-2">
            <span>Email</span>
            <input type="email" autoComplete="email" required value={form.email} onChange={set('email')} />
          </label>
          <label className="field">
            <span>Password</span>
            <input type="password" autoComplete="new-password" minLength={8} required value={form.password} onChange={set('password')} />
          </label>
          <label className="field">
            <span>Confirm password</span>
            <input type="password" autoComplete="new-password" minLength={8} required value={form.confirm} onChange={set('confirm')} />
          </label>
        </div>

        <button className="btn btn-primary btn-block" disabled={busy}>
          {busy ? 'Creating account…' : 'Create account'}
        </button>
        <p className="muted center">
          Already registered? <Link to="/login">Sign in</Link>
        </p>
      </form>
    </div>
  );
}

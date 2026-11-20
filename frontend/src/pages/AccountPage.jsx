import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { authApi, playersApi } from '../api';
import { CameraIcon } from '../components/Icons';
import { Avatar, Badge, ErrorBanner, Loader } from '../components/UI';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { PLAYING_CATEGORIES, formatDateTime } from '../utils/format';

export default function AccountPage() {
  const { user, refresh } = useAuth();
  const toast = useToast();
  const [player, setPlayer] = useState(null);
  const [profile, setProfile] = useState(null);
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);

  useEffect(() => {
    if (!user?.playerId) return;
    playersApi.get(user.playerId).then((d) => {
      setPlayer(d.player);
      setProfile({ fullName: d.player.fullName, age: d.player.age, playingCategory: d.player.playingCategory });
    }).catch(setError);
  }, [user?.playerId]);

  const saveProfile = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const updated = await playersApi.updateMe({ ...profile, age: Number(profile.age) });
      setPlayer(updated);
      await refresh();
      toast.success('Profile updated.');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const uploadPhoto = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      toast.error('Image must be 2 MB or smaller.');
      return;
    }
    try {
      setPlayer(await playersApi.uploadPhoto(player.id, file));
      toast.success('Photo updated.');
    } catch (err) {
      toast.error(err.message);
    }
  };

  const removePhoto = async () => {
    try {
      await playersApi.deletePhoto(player.id);
      setPlayer((p) => ({ ...p, photoUrl: null }));
      toast.success('Photo removed.');
    } catch (err) {
      toast.error(err.message);
    }
  };

  const changePassword = async (e) => {
    e.preventDefault();
    if (pw.next !== pw.confirm) {
      toast.error('New passwords do not match.');
      return;
    }
    try {
      await authApi.changePassword(pw.current, pw.next);
      setPw({ current: '', next: '', confirm: '' });
      toast.success('Password changed.');
    } catch (err) {
      toast.error(err.message);
    }
  };

  return (
    <div className="container page narrow">
      <h1>My account</h1>
      <ErrorBanner error={error} />

      <section className="card">
        <h2>Account</h2>
        <dl className="kv">
          <dt>Email</dt><dd>{user.email}</dd>
          <dt>Role</dt><dd><Badge tone={user.role === 'Admin' ? 'gold' : 'green'}>{user.role}</Badge></dd>
          <dt>Last sign-in</dt><dd>{formatDateTime(user.lastLoginAt)}</dd>
        </dl>
      </section>

      {user.playerId && (
        <section className="card">
          <div className="card-head">
            <h2>Player profile</h2>
            <Link to={`/players/${user.playerId}`} className="btn btn-sm btn-ghost">View public profile</Link>
          </div>
          {!player || !profile ? (
            <Loader />
          ) : (
            <>
              <div className="photo-row">
                <Avatar name={player.fullName} url={player.photoUrl} size={88} />
                <div className="photo-actions">
                  <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" hidden onChange={uploadPhoto} />
                  <button type="button" className="btn btn-sm btn-ghost" onClick={() => fileRef.current?.click()}>
                    <CameraIcon size={16} /> Upload photo
                  </button>
                  {player.photoUrl && (
                    <button type="button" className="btn btn-sm btn-ghost danger" onClick={removePhoto}>Remove</button>
                  )}
                  <span className="muted small">JPEG, PNG, WEBP or GIF · max 2 MB</span>
                </div>
              </div>
              <form className="form-grid" onSubmit={saveProfile}>
                <label className="field span-2">
                  <span>Full name</span>
                  <input required minLength={2} value={profile.fullName} onChange={(e) => setProfile({ ...profile, fullName: e.target.value })} />
                </label>
                <label className="field">
                  <span>Age</span>
                  <input type="number" min={5} max={120} required value={profile.age} onChange={(e) => setProfile({ ...profile, age: e.target.value })} />
                </label>
                <label className="field">
                  <span>Playing category</span>
                  <select value={profile.playingCategory} onChange={(e) => setProfile({ ...profile, playingCategory: e.target.value })}>
                    {PLAYING_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                  </select>
                </label>
                <p className="muted small span-2">
                  Gender ({player.gender}) and skill level ({player.skillLevel}) are managed by league administrators.
                </p>
                <div className="span-2">
                  <button className="btn btn-primary" disabled={busy}>Save profile</button>
                </div>
              </form>
            </>
          )}
        </section>
      )}

      <section className="card">
        <h2>Change password</h2>
        <form className="form-grid" onSubmit={changePassword}>
          <label className="field span-2">
            <span>Current password</span>
            <input type="password" autoComplete="current-password" required value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} />
          </label>
          <label className="field">
            <span>New password</span>
            <input type="password" autoComplete="new-password" minLength={8} required value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} />
          </label>
          <label className="field">
            <span>Confirm new password</span>
            <input type="password" autoComplete="new-password" minLength={8} required value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} />
          </label>
          <div className="span-2">
            <button className="btn btn-primary">Update password</button>
          </div>
        </form>
      </section>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { assetUrl } from '../api/client';
import { initials, label } from '../utils/format';
import { ArrowDownIcon, ArrowUpIcon, ChevronLeftIcon, ChevronRightIcon, CloseIcon } from './Icons';

export function Avatar({ name, url, size = 40, className = '' }) {
  const [failed, setFailed] = useState(false);
  const src = assetUrl(url);
  useEffect(() => setFailed(false), [src]);

  return (
    <span className={`avatar ${className}`} style={{ width: size, height: size, fontSize: size * 0.38 }}>
      {src && !failed ? (
        <img src={src} alt="" loading="lazy" onError={() => setFailed(true)} />
      ) : (
        <span>{initials(name)}</span>
      )}
    </span>
  );
}

export function RankMovement({ movement, previousRank }) {
  if (previousRank === null || previousRank === undefined)
    return <span className="move move-new" title="New to the rankings">NEW</span>;
  if (!movement) return <span className="move move-same" title="No change">–</span>;
  if (movement > 0)
    return (
      <span className="move move-up" title={`Up ${movement} from #${previousRank}`}>
        <ArrowUpIcon size={12} />
        {movement}
      </span>
    );
  return (
    <span className="move move-down" title={`Down ${-movement} from #${previousRank}`}>
      <ArrowDownIcon size={12} />
      {-movement}
    </span>
  );
}

export function Badge({ children, tone = 'neutral' }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

const SKILL_TONES = { Beginner: 'neutral', Intermediate: 'info', Advanced: 'green', Pro: 'gold' };
export const SkillBadge = ({ level }) => <Badge tone={SKILL_TONES[level] || 'neutral'}>{level}</Badge>;

export const CategoryBadge = ({ value }) => <Badge tone="outline">{label(value)}</Badge>;

export function Loader({ text = 'Loading…' }) {
  return (
    <div className="loader" role="status">
      <span className="loader-ball" />
      <span>{text}</span>
    </div>
  );
}

export function EmptyState({ title, children, action }) {
  return (
    <div className="empty">
      <div className="empty-ball" aria-hidden="true" />
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function ErrorBanner({ error, onRetry }) {
  if (!error) return null;
  return (
    <div className="alert alert-error" role="alert">
      <span>{typeof error === 'string' ? error : error.message}</span>
      {onRetry && (
        <button className="btn btn-sm btn-ghost" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  );
}

export function StatCard({ label: text, value, sub, icon, tone = '' }) {
  return (
    <div className={`stat-card ${tone}`}>
      <div className="stat-top">
        <span className="stat-label">{text}</span>
        {icon && <span className="stat-icon">{icon}</span>}
      </div>
      <div className="stat-value">{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

export function Pagination({ page, totalPages, onChange }) {
  if (!totalPages || totalPages <= 1) return null;
  return (
    <nav className="pagination" aria-label="Pagination">
      <button className="btn btn-sm btn-ghost" disabled={page <= 1} onClick={() => onChange(page - 1)}>
        <ChevronLeftIcon size={16} /> Prev
      </button>
      <span>
        Page {page} of {totalPages}
      </span>
      <button className="btn btn-sm btn-ghost" disabled={page >= totalPages} onClick={() => onChange(page + 1)}>
        Next <ChevronRightIcon size={16} />
      </button>
    </nav>
  );
}

export function Modal({ open, title, onClose, children, footer, wide = false }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <header className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <CloseIcon />
          </button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </div>
    </div>
  );
}

/** Small hook for debounced values (search boxes). */
export function useDebounced(value, delay = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
}

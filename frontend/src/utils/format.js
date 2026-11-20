export const SCOPES = [
  { value: 'Overall', label: 'Overall' },
  { value: 'Singles', label: 'Singles' },
  { value: 'Doubles', label: 'Doubles' },
  { value: 'Mens', label: "Men's" },
  { value: 'Womens', label: "Women's" },
  { value: 'MixedDoubles', label: 'Mixed Doubles' },
];

export const GENDERS = ['Male', 'Female', 'Other'];
export const SKILL_LEVELS = ['Beginner', 'Intermediate', 'Advanced', 'Pro'];
export const PLAYING_CATEGORIES = ['Singles', 'Doubles', 'Both'];
export const MATCH_TYPES = ['Singles', 'Doubles'];
export const MATCH_CATEGORIES = [
  { value: 'Open', label: 'Open' },
  { value: 'Mens', label: "Men's" },
  { value: 'Womens', label: "Women's" },
  { value: 'Mixed', label: 'Mixed' },
];

const LABELS = {
  Mens: "Men's",
  Womens: "Women's",
  MixedDoubles: 'Mixed Doubles',
  Mixed: 'Mixed',
  MatchCreated: 'Match created',
  MatchUpdated: 'Match details edited',
  ResultRecorded: 'Result recorded',
  ResultCorrected: 'Result corrected',
  MatchCancelled: 'Match cancelled',
  MatchRestored: 'Match restored',
};

export const label = (v) => LABELS[v] ?? v ?? '';

export function formatDate(value) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function formatDateTime(value) {
  if (!value) return '—';
  return new Date(value).toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

export const formatPct = (v) => `${Number(v ?? 0).toFixed(1)}%`;

/** Value for <input type="datetime-local"> from an ISO string (local time). */
export function toLocalInput(value) {
  const d = value ? new Date(value) : new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export const fromLocalInput = (value) => new Date(value).toISOString();

export function initials(name = '') {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0].toUpperCase())
    .join('');
}

/** Result of a match from one player's perspective: 'W', 'L' or null. */
export function outcomeFor(match, playerId) {
  if (!match.result) return null;
  const onTeam1 = match.team1.some((p) => p.playerId === playerId);
  const team = onTeam1 ? 1 : 2;
  return match.result.winningTeam === team ? 'W' : 'L';
}

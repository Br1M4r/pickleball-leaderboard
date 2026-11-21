// Turns database rows into the exact JSON shapes the original API returned (camelCase, enum names).

const iso = (d) => (d === null || d === undefined ? null : new Date(d).toISOString());
const num = (v) => (v === null || v === undefined ? null : Number(v));

/** Cache-busting photo URL; the version is the .NET tick count of the upload time. */
export function photoUrl(playerId, photoUpdatedAt) {
  if (!photoUpdatedAt) return null;
  const ticks = BigInt(new Date(photoUpdatedAt).getTime()) * 10000n + 621355968000000000n;
  return `/api/players/${playerId}/photo?v=${ticks}`;
}

/** Row from "Players" (optionally joined with "Users"."Email" AS "UserEmail"). */
export function playerDto(p, includeAccount = false) {
  return {
    id: p.Id,
    fullName: p.FullName,
    gender: p.Gender,
    age: p.Age,
    skillLevel: p.SkillLevel,
    playingCategory: p.PlayingCategory,
    dateRegistered: iso(p.DateRegistered),
    isActive: p.IsActive,
    photoUrl: photoUrl(p.Id, p.PhotoUpdatedAt),
    userId: includeAccount ? p.UserId ?? null : null,
    email: includeAccount ? p.UserEmail ?? null : null,
  };
}

/** Row from "Users" joined with player "PlayerId"/"PlayerName". */
export function userDto(u) {
  return {
    id: u.Id,
    email: u.Email,
    role: u.Role,
    isActive: u.IsActive,
    playerId: u.PlayerId ?? null,
    playerName: u.PlayerName ?? null,
    createdAt: iso(u.CreatedAt),
    lastLoginAt: iso(u.LastLoginAt),
  };
}

export const USER_SELECT = `
  SELECT u.*, p."Id" AS "PlayerId", p."FullName" AS "PlayerName"
  FROM "Users" u LEFT JOIN "Players" p ON p."UserId" = u."Id"`;

export const LEADERBOARD_SELECT = `
  SELECT e.*, p."FullName", p."Gender", p."SkillLevel", p."PhotoUpdatedAt"
  FROM "Leaderboard" e JOIN "Players" p ON p."Id" = e."PlayerId"`;

export function leaderboardRow(e) {
  return {
    scope: e.Scope,
    rank: e.Rank,
    previousRank: e.PreviousRank ?? null,
    movement: e.PreviousRank === null || e.PreviousRank === undefined ? null : e.PreviousRank - e.Rank,
    playerId: e.PlayerId,
    fullName: e.FullName,
    photoUrl: photoUrl(e.PlayerId, e.PhotoUpdatedAt),
    gender: e.Gender,
    skillLevel: e.SkillLevel,
    matchesPlayed: e.MatchesPlayed,
    wins: e.Wins,
    losses: e.Losses,
    winPercentage: num(e.WinPercentage),
    points: e.Points,
    currentWinStreak: e.CurrentWinStreak,
    longestWinStreak: e.LongestWinStreak,
    pointsFor: e.PointsFor,
    pointsAgainst: e.PointsAgainst,
    lastMatchAt: iso(e.LastMatchAt),
  };
}

export function rulesDto(r) {
  return {
    id: r.Id,
    name: r.Name,
    winPoints: r.WinPoints,
    lossPoints: r.LossPoints,
    marginBonusThreshold: r.MarginBonusThreshold,
    marginBonusPoints: r.MarginBonusPoints,
    streakBonusThreshold: r.StreakBonusThreshold,
    streakBonusPoints: r.StreakBonusPoints,
    minMatchesToRank: r.MinMatchesToRank,
    allowNegativePoints: r.AllowNegativePoints,
    updatedAt: iso(r.UpdatedAt),
  };
}

export function paged(items, page, pageSize, totalCount) {
  return { items, page, pageSize, totalCount, totalPages: pageSize === 0 ? 0 : Math.ceil(totalCount / pageSize) };
}

/**
 * Loads matches with participants (+ player names/photos/genders) and results,
 * returned in the order of `ids`. Each item is an in-memory "match model".
 */
export async function loadMatches(db, ids) {
  if (!ids.length) return [];
  // A transaction runs on one connection, so its queries must go one at a time.
  const all = db.inTransaction
    ? async (thunks) => {
        const out = [];
        for (const t of thunks) out.push(await t());
        return out;
      }
    : (thunks) => Promise.all(thunks.map((t) => t()));

  const [matches, parts, results] = await all([
    () => db.query('SELECT * FROM "Matches" WHERE "Id" = ANY($1::int[])', [ids]),
    () => db.query(
      `SELECT mp."Id", mp."MatchId", mp."PlayerId", mp."Team",
              p."FullName", p."Gender", p."PhotoUpdatedAt"
       FROM "MatchParticipants" mp JOIN "Players" p ON p."Id" = mp."PlayerId"
       WHERE mp."MatchId" = ANY($1::int[]) ORDER BY mp."Id"`,
      [ids],
    ),
    () => db.query('SELECT * FROM "MatchResults" WHERE "MatchId" = ANY($1::int[])', [ids]),
  ]);

  const byId = new Map(
    matches.map((m) => [
      m.Id,
      {
        id: m.Id,
        matchType: m.MatchType,
        category: m.Category,
        status: m.Status,
        playedAt: new Date(m.PlayedAt),
        location: m.Location,
        notes: m.Notes,
        createdAt: new Date(m.CreatedAt),
        updatedAt: new Date(m.UpdatedAt),
        participants: [],
        result: null,
      },
    ]),
  );
  for (const p of parts) {
    byId.get(p.MatchId)?.participants.push({
      id: p.Id,
      playerId: p.PlayerId,
      team: p.Team,
      fullName: p.FullName,
      gender: p.Gender,
      photoUpdatedAt: p.PhotoUpdatedAt,
    });
  }
  for (const r of results) {
    const m = byId.get(r.MatchId);
    if (m) {
      m.result = {
        team1Score: r.Team1Score,
        team2Score: r.Team2Score,
        winningTeam: r.WinningTeam,
        recordedAt: new Date(r.RecordedAt),
        updatedAt: r.UpdatedAt ? new Date(r.UpdatedAt) : null,
      };
    }
  }
  return ids.map((id) => byId.get(id)).filter(Boolean);
}

export async function loadMatch(db, id) {
  return (await loadMatches(db, [id]))[0] ?? null;
}

export function matchDto(m) {
  const p = (x) => ({
    playerId: x.playerId,
    fullName: x.fullName ?? 'Unknown',
    photoUrl: photoUrl(x.playerId, x.photoUpdatedAt),
    team: x.team,
    gender: x.gender ?? 'Other',
  });
  const byId = (a, b) => a.id - b.id;
  return {
    id: m.id,
    matchType: m.matchType,
    category: m.category,
    status: m.status,
    playedAt: iso(m.playedAt),
    location: m.location ?? null,
    notes: m.notes ?? null,
    team1: m.participants.filter((x) => x.team === 1).sort(byId).map(p),
    team2: m.participants.filter((x) => x.team === 2).sort(byId).map(p),
    result: m.result
      ? {
          team1Score: m.result.team1Score,
          team2Score: m.result.team2Score,
          winningTeam: m.result.winningTeam,
          recordedAt: iso(m.result.recordedAt),
          updatedAt: iso(m.result.updatedAt),
        }
      : null,
    createdAt: iso(m.createdAt),
    updatedAt: iso(m.updatedAt),
  };
}

/** JSON snapshot of a match used in the audit history. */
export function snapshot(m) {
  const team = (t) => m.participants.filter((x) => x.team === t).map((x) => ({ playerId: x.playerId, name: x.fullName ?? null }));
  return JSON.stringify({
    matchType: m.matchType,
    category: m.category,
    status: m.status,
    playedAt: iso(m.playedAt),
    location: m.location ?? null,
    notes: m.notes ?? null,
    team1: team(1),
    team2: team(2),
    result: m.result
      ? { team1Score: m.result.team1Score, team2Score: m.result.team2Score, winningTeam: m.result.winningTeam }
      : null,
  });
}

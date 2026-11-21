import { Enums } from './validate.js';

// Port of RankingCalculator + LeaderboardService. Rankings are always rebuilt from the full
// match history in chronological order, so corrections to old matches produce the same
// result as if the corrected score had been entered originally.

export async function getActiveRules(db) {
  const select = () => db.one('SELECT * FROM "RankingRules" WHERE "IsActive" LIMIT 1');
  const rules = await select();
  if (rules) return rules;
  await db.query(
    `INSERT INTO "RankingRules" ("Name", "WinPoints", "LossPoints", "MarginBonusThreshold", "MarginBonusPoints",
       "StreakBonusThreshold", "StreakBonusPoints", "MinMatchesToRank", "AllowNegativePoints", "IsActive", "UpdatedAt")
     VALUES ('Default', 3, 0, 5, 1, 3, 1, 1, FALSE, TRUE, now())
     ON CONFLICT ("IsActive") WHERE "IsActive" = TRUE DO NOTHING`,
  );
  return select();
}

export function isInScope(scope, type, category) {
  switch (scope) {
    case 'Overall': return true;
    case 'Singles': return type === 'Singles';
    case 'Doubles': return type === 'Doubles';
    case 'Mens': return category === 'Mens';
    case 'Womens': return category === 'Womens';
    case 'MixedDoubles': return type === 'Doubles' && category === 'Mixed';
    default: return false;
  }
}

/** Win % in hundredths, rounded half away from zero (exact integer math, no float drift). */
export function winPctHundredths(wins, played) {
  if (played === 0) return 0;
  const num = wins * 10000;
  const q = Math.floor(num / played);
  return 2 * (num - q * played) >= played ? q + 1 : q;
}

/**
 * @param matches [{ id, playedAt: Date, matchType, category, team1: [ids], team2: [ids], team1Score, team2Score }]
 * @param eligible Set of player ids that may be ranked.
 */
export function calculate(scope, matches, rules, eligible) {
  const table = new Map();
  const get = (id) => {
    let s = table.get(id);
    if (!s) {
      s = { playerId: id, wins: 0, losses: 0, points: 0, currentWinStreak: 0, longestWinStreak: 0, pointsFor: 0, pointsAgainst: 0, lastMatchAt: null };
      table.set(id, s);
    }
    return s;
  };

  const ordered = matches
    .filter((m) => isInScope(scope, m.matchType, m.category))
    .sort((a, b) => a.playedAt - b.playedAt || a.id - b.id);

  for (const m of ordered) {
    const team1Won = m.team1Score > m.team2Score;
    const margin = Math.abs(m.team1Score - m.team2Score);

    const apply = (team, won, scored, conceded) => {
      for (const playerId of team) {
        const s = get(playerId);
        s.pointsFor += scored;
        s.pointsAgainst += conceded;
        s.lastMatchAt = m.playedAt;

        if (won) {
          s.wins++;
          s.currentWinStreak++;
          s.longestWinStreak = Math.max(s.longestWinStreak, s.currentWinStreak);
          s.points += rules.WinPoints;
          if (rules.MarginBonusThreshold > 0 && margin >= rules.MarginBonusThreshold) s.points += rules.MarginBonusPoints;
          if (rules.StreakBonusThreshold > 0 && s.currentWinStreak % rules.StreakBonusThreshold === 0) s.points += rules.StreakBonusPoints;
        } else {
          s.losses++;
          s.currentWinStreak = 0;
          s.points += rules.LossPoints;
        }

        if (!rules.AllowNegativePoints && s.points < 0) s.points = 0;
      }
    };

    apply(m.team1, team1Won, m.team1Score, m.team2Score);
    apply(m.team2, !team1Won, m.team2Score, m.team1Score);
  }

  const minMatches = Math.max(1, rules.MinMatchesToRank);
  const ranked = [...table.values()]
    .map((s) => {
      const played = s.wins + s.losses;
      return { ...s, matchesPlayed: played, pct: winPctHundredths(s.wins, played), diff: s.pointsFor - s.pointsAgainst };
    })
    .filter((s) => eligible.has(s.playerId) && s.matchesPlayed >= minMatches)
    .sort((a, b) => b.points - a.points || b.pct - a.pct || b.wins - a.wins || b.diff - a.diff || a.playerId - b.playerId);

  // Standard competition ranking (1, 2, 2, 4): fully tied players share a rank.
  ranked.forEach((s, i) => {
    const prev = ranked[i - 1];
    s.rank = prev && prev.points === s.points && prev.pct === s.pct && prev.wins === s.wins && prev.diff === s.diff ? prev.rank : i + 1;
  });
  return ranked;
}

/** Rebuilds every leaderboard scope. Must run inside a transaction (`db.tx`). */
export async function recalculate(db) {
  if (!db.inTransaction) return db.tx((t) => recalculate(t));

  // Serialise recalculations across all serverless instances.
  await db.query('SELECT pg_advisory_xact_lock(727274)');
  const rules = await getActiveRules(db);

  const rows = await db.query(
    `SELECT m."Id", m."PlayedAt", m."MatchType", m."Category", r."Team1Score", r."Team2Score"
     FROM "Matches" m JOIN "MatchResults" r ON r."MatchId" = m."Id"
     WHERE m."Status" = 'Completed'`,
  );
  const parts = await db.query(
    `SELECT p."MatchId", p."PlayerId", p."Team" FROM "MatchParticipants" p
     JOIN "Matches" m ON m."Id" = p."MatchId" WHERE m."Status" = 'Completed'`,
  );
  const byMatch = new Map();
  for (const p of parts) {
    if (!byMatch.has(p.MatchId)) byMatch.set(p.MatchId, []);
    byMatch.get(p.MatchId).push(p);
  }
  const matches = rows.map((m) => {
    const ps = byMatch.get(m.Id) ?? [];
    return {
      id: m.Id,
      playedAt: new Date(m.PlayedAt),
      matchType: m.MatchType,
      category: m.Category,
      team1: ps.filter((p) => p.Team === 1).map((p) => p.PlayerId),
      team2: ps.filter((p) => p.Team === 2).map((p) => p.PlayerId),
      team1Score: m.Team1Score,
      team2Score: m.Team2Score,
    };
  });

  const eligible = new Set((await db.query('SELECT "Id" FROM "Players" WHERE "IsActive"')).map((r) => r.Id));
  const existing = await db.query('SELECT "Id", "PlayerId", "Scope", "Rank", "PreviousRank" FROM "Leaderboard"');
  const now = new Date().toISOString();

  const upserts = [];
  const staleIds = [];

  for (const scope of Enums.LeaderboardScope) {
    const standings = calculate(scope, matches, rules, eligible);
    const current = new Map(existing.filter((e) => e.Scope === scope).map((e) => [e.PlayerId, e]));

    // Only shift "previous rank" when the standings actually moved,
    // so repeated recalculations don't erase movement indicators.
    const newIds = new Set(standings.map((s) => s.playerId));
    const changed = newIds.size !== current.size || standings.some((s) => current.get(s.playerId)?.Rank !== s.rank);

    for (const s of standings) {
      const old = current.get(s.playerId);
      const previousRank = !old ? null : changed ? old.Rank : old.PreviousRank;
      upserts.push({ ...s, scope, previousRank });
    }
    for (const e of current.values()) if (!newIds.has(e.PlayerId)) staleIds.push(e.Id);
  }

  if (staleIds.length) await db.query('DELETE FROM "Leaderboard" WHERE "Id" = ANY($1::int[])', [staleIds]);

  if (upserts.length) {
    const col = (f) => upserts.map(f);
    await db.query(
      `INSERT INTO "Leaderboard" ("PlayerId", "Scope", "Rank", "PreviousRank", "MatchesPlayed", "Wins", "Losses",
         "WinPercentage", "Points", "CurrentWinStreak", "LongestWinStreak", "PointsFor", "PointsAgainst", "LastMatchAt", "UpdatedAt")
       SELECT * FROM unnest($1::int[], $2::text[], $3::int[], $4::int[], $5::int[], $6::int[], $7::int[],
         $8::numeric[], $9::int[], $10::int[], $11::int[], $12::int[], $13::int[], $14::timestamptz[], $15::timestamptz[])
       ON CONFLICT ("PlayerId", "Scope") DO UPDATE SET
         "Rank" = EXCLUDED."Rank", "PreviousRank" = EXCLUDED."PreviousRank", "MatchesPlayed" = EXCLUDED."MatchesPlayed",
         "Wins" = EXCLUDED."Wins", "Losses" = EXCLUDED."Losses", "WinPercentage" = EXCLUDED."WinPercentage",
         "Points" = EXCLUDED."Points", "CurrentWinStreak" = EXCLUDED."CurrentWinStreak",
         "LongestWinStreak" = EXCLUDED."LongestWinStreak", "PointsFor" = EXCLUDED."PointsFor",
         "PointsAgainst" = EXCLUDED."PointsAgainst", "LastMatchAt" = EXCLUDED."LastMatchAt", "UpdatedAt" = EXCLUDED."UpdatedAt"`,
      [
        col((u) => u.playerId),
        col((u) => u.scope),
        col((u) => u.rank),
        col((u) => u.previousRank),
        col((u) => u.matchesPlayed),
        col((u) => u.wins),
        col((u) => u.losses),
        col((u) => (u.pct / 100).toFixed(2)),
        col((u) => u.points),
        col((u) => u.currentWinStreak),
        col((u) => u.longestWinStreak),
        col((u) => u.pointsFor),
        col((u) => u.pointsAgainst),
        col((u) => (u.lastMatchAt ? u.lastMatchAt.toISOString() : null)),
        col(() => now),
      ],
    );
  }

  console.log(`Leaderboard recalculated from ${matches.length} completed matches`);
}

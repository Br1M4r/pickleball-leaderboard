import { LEADERBOARD_SELECT, leaderboardRow, rulesDto } from '../mapping.js';
import { getActiveRules, recalculate } from '../ranking.js';
import { Enums, clamp, readQuery, validate } from '../validate.js';

// ------------------------------------------------------------------ leaderboard

const SORTS = {
  name: (d) => `p."FullName" ${d}`,
  points: (d) => `e."Points" ${d}, e."Rank" ${d === 'ASC' ? 'DESC' : 'ASC'}`,
  wins: (d) => `e."Wins" ${d}, e."Rank" ASC`,
  losses: (d) => `e."Losses" ${d}, e."Rank" ASC`,
  matches: (d) => `e."MatchesPlayed" ${d}, e."Rank" ASC`,
  winpercentage: (d) => `e."WinPercentage" ${d}, e."Rank" ASC`,
  streak: (d) => `e."CurrentWinStreak" ${d}, e."Rank" ASC`,
};

/** Public leaderboard. Each scope is ranked independently; filters narrow the rows shown. */
async function get(ctx) {
  const q = readQuery(ctx.query, {
    scope: { type: 'enum', values: Enums.LeaderboardScope, default: 'Overall' },
    skillLevel: { type: 'enum', values: Enums.SkillLevel },
    gender: { type: 'enum', values: Enums.Gender },
    search: { type: 'string' },
    sortBy: { type: 'string', default: 'rank' },
    sortDir: { type: 'string', default: 'asc' },
    limit: { type: 'int', default: 200 },
  });
  const limit = clamp(q.limit, 1, 500);

  const base = await ctx.db.one(
    `SELECT count(*)::int AS total, max(e."UpdatedAt") AS last
     FROM "Leaderboard" e JOIN "Players" p ON p."Id" = e."PlayerId"
     WHERE e."Scope" = $1 AND p."IsActive"`,
    [q.scope],
  );

  const params = [q.scope];
  const where = ['e."Scope" = $1', 'p."IsActive"'];
  if (q.skillLevel) {
    params.push(q.skillLevel);
    where.push(`p."SkillLevel" = $${params.length}`);
  }
  if (q.gender) {
    params.push(q.gender);
    where.push(`p."Gender" = $${params.length}`);
  }
  if (q.search && q.search.trim()) {
    params.push(`%${q.search.trim()}%`);
    where.push(`p."FullName" ILIKE $${params.length}`);
  }

  const desc = q.sortDir.toLowerCase() === 'desc';
  const sort = SORTS[q.sortBy.toLowerCase()];
  const orderBy = sort
    ? sort(desc ? 'DESC' : 'ASC')
    : desc
      ? 'e."Rank" DESC, p."FullName" DESC'
      : 'e."Rank" ASC, p."FullName" ASC';

  const rows = await ctx.db.query(
    `${LEADERBOARD_SELECT} WHERE ${where.join(' AND ')} ORDER BY ${orderBy} LIMIT ${limit}`,
    params,
  );

  return {
    scope: q.scope,
    lastUpdated: base.last ? new Date(base.last).toISOString() : null,
    totalRanked: base.total,
    rows: rows.map(leaderboardRow),
  };
}

/** Force a full rebuild of all rankings from match history. */
async function recalc(ctx) {
  await ctx.db.tx((t) => recalculate(t));
  return null;
}

// ------------------------------------------------------------------ ranking rules

/** Public so players can see how points are earned. */
async function getRules(ctx) {
  return rulesDto(await getActiveRules(ctx.db));
}

/** Update the active rules and rebuild every ranking with them. */
async function updateRules(ctx) {
  const req = validate(await ctx.json(), {
    name: { type: 'string', required: true, minLength: 1, maxLength: 80, default: 'Default' },
    winPoints: { type: 'int', min: 0, max: 100, default: 0 },
    lossPoints: { type: 'int', min: -100, max: 100, default: 0 },
    marginBonusThreshold: { type: 'int', min: 0, max: 99, default: 0 },
    marginBonusPoints: { type: 'int', min: 0, max: 100, default: 0 },
    streakBonusThreshold: { type: 'int', min: 0, max: 50, default: 0 },
    streakBonusPoints: { type: 'int', min: 0, max: 100, default: 0 },
    minMatchesToRank: { type: 'int', min: 1, max: 100, default: 1 },
    allowNegativePoints: { type: 'bool', default: false },
  });

  const rules = await ctx.db.tx(async (t) => {
    const current = await getActiveRules(t);
    const updated = await t.one(
      `UPDATE "RankingRules" SET "Name" = $2, "WinPoints" = $3, "LossPoints" = $4, "MarginBonusThreshold" = $5,
         "MarginBonusPoints" = $6, "StreakBonusThreshold" = $7, "StreakBonusPoints" = $8, "MinMatchesToRank" = $9,
         "AllowNegativePoints" = $10, "UpdatedAt" = now(), "UpdatedByUserId" = $11
       WHERE "Id" = $1 RETURNING *`,
      [
        current.Id, req.name.trim(), req.winPoints, req.lossPoints, req.marginBonusThreshold, req.marginBonusPoints,
        req.streakBonusThreshold, req.streakBonusPoints, req.minMatchesToRank, req.allowNegativePoints, ctx.user.userId,
      ],
    );
    await recalculate(t);
    return updated;
  });

  return rulesDto(rules);
}

export default [
  { method: 'GET', path: '/api/leaderboard', handler: get },
  { method: 'POST', path: '/api/leaderboard/recalculate', handler: recalc, auth: 'admin' },
  { method: 'GET', path: '/api/ranking-rules', handler: getRules },
  { method: 'PUT', path: '/api/ranking-rules', handler: updateRules, auth: 'admin' },
];

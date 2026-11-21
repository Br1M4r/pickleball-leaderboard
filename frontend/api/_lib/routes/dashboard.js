import { LEADERBOARD_SELECT, leaderboardRow, loadMatches, matchDto } from '../mapping.js';
import { Enums } from '../validate.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

async function get(ctx) {
  const { db } = ctx;
  const COMPLETED = `m."Status" = 'Completed' AND EXISTS (SELECT 1 FROM "MatchResults" r WHERE r."MatchId" = m."Id")`;

  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5, 1));

  const [counts, wl, top, bestRates, streaks, recentIds, skills, dates] = await Promise.all([
    db.one(
      `SELECT
         (SELECT count(*)::int FROM "Players") AS "totalPlayers",
         (SELECT count(*)::int FROM "Players" WHERE "IsActive") AS "activePlayers",
         (SELECT count(*)::int FROM "Matches" m WHERE ${COMPLETED}) AS "totalMatches",
         (SELECT count(*)::int FROM "Matches" m WHERE ${COMPLETED} AND m."MatchType" = 'Singles') AS "singles",
         (SELECT count(*)::int FROM "Matches" WHERE "Status" = 'Scheduled') AS "scheduled"`,
    ),
    db.one(
      `SELECT count(*) FILTER (WHERE mp."Team" = r."WinningTeam")::int AS wins,
              count(*) FILTER (WHERE mp."Team" <> r."WinningTeam")::int AS losses
       FROM "MatchParticipants" mp
       JOIN "Matches" m ON m."Id" = mp."MatchId"
       JOIN "MatchResults" r ON r."MatchId" = m."Id"
       WHERE m."Status" = 'Completed'`,
    ),
    db.query(`${LEADERBOARD_SELECT} WHERE e."Scope" = 'Overall' AND p."IsActive" ORDER BY e."Rank", e."PlayerId" LIMIT 5`),
    db.query(
      `${LEADERBOARD_SELECT} WHERE e."Scope" = 'Overall' AND p."IsActive" AND e."MatchesPlayed" >= 3
       ORDER BY e."WinPercentage" DESC, e."Wins" DESC, e."Rank" LIMIT 5`,
    ),
    db.query(
      `${LEADERBOARD_SELECT} WHERE e."Scope" = 'Overall' AND p."IsActive" AND e."CurrentWinStreak" > 0
       ORDER BY e."CurrentWinStreak" DESC, e."Rank" LIMIT 5`,
    ),
    db.query(`SELECT "Id" FROM "Matches" WHERE "Status" = 'Completed' ORDER BY "PlayedAt" DESC, "Id" DESC LIMIT 8`),
    db.query(`SELECT "SkillLevel", count(*)::int AS n FROM "Players" WHERE "IsActive" GROUP BY "SkillLevel"`),
    db.query(`SELECT m."PlayedAt" FROM "Matches" m WHERE ${COMPLETED} AND m."PlayedAt" >= $1`, [start.toISOString()]),
  ]);

  const recent = await loadMatches(db, recentIds.map((r) => r.Id));

  const skillDistribution = Enums.SkillLevel.map((s) => ({
    label: s,
    count: skills.find((x) => x.SkillLevel === s)?.n ?? 0,
  }));

  const matchesPerMonth = Array.from({ length: 6 }, (_, i) => {
    const month = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i, 1));
    const y = month.getUTCFullYear();
    const mo = month.getUTCMonth();
    return {
      label: `${MONTHS[mo]} ${y}`,
      count: dates.filter((d) => {
        const t = new Date(d.PlayedAt);
        return t.getUTCFullYear() === y && t.getUTCMonth() === mo;
      }).length,
    };
  });

  return {
    totalPlayers: counts.totalPlayers,
    activePlayers: counts.activePlayers,
    totalMatches: counts.totalMatches,
    scheduledMatches: counts.scheduled,
    singlesMatches: counts.singles,
    doublesMatches: counts.totalMatches - counts.singles,
    totalWins: wl.wins,
    totalLosses: wl.losses,
    topPlayers: top.map(leaderboardRow),
    bestWinRates: bestRates.map(leaderboardRow),
    hottestStreaks: streaks.map(leaderboardRow),
    recentMatches: recent.map(matchDto),
    skillDistribution,
    matchesPerMonth,
  };
}

export default [{ method: 'GET', path: '/api/dashboard', handler: get, auth: 'admin' }];

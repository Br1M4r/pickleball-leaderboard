import { badRequest, forbidden, notFound } from '../http.js';
import { loadMatch, loadMatches, matchDto, paged, snapshot } from '../mapping.js';
import { recalculate } from '../ranking.js';
import { Enums, clamp, readQuery, validate } from '../validate.js';

const scoreFields = {
  team1Score: { type: 'int', required: true, min: 0, max: 99 },
  team2Score: { type: 'int', required: true, min: 0, max: 99 },
};

const upsertSpec = {
  matchType: { type: 'enum', values: Enums.MatchFormat, required: true },
  category: { type: 'enum', values: Enums.MatchCategory, required: true },
  playedAt: { type: 'date', required: true },
  location: { type: 'string', maxLength: 150 },
  notes: { type: 'string', maxLength: 1000 },
  team1PlayerIds: { type: 'intArray', required: true, minLength: 1, maxLength: 2 },
  team2PlayerIds: { type: 'intArray', required: true, minLength: 1, maxLength: 2 },
  result: { type: 'object', fields: scoreFields },
  reason: { type: 'string', maxLength: 500 },
};

const reasonSpec = { reason: { type: 'string', maxLength: 500 } };

const clean = (s) => (typeof s === 'string' && s.trim() ? s.trim() : null);
const inFuture = (d) => d.getTime() > Date.now() + 24 * 60 * 60 * 1000;

// ------------------------------------------------------------------ validation & helpers

/** Validates team sizes, duplicates, player status and category/gender rules. */
async function validateLineup(db, req, existingIds) {
  const size = req.matchType === 'Singles' ? 1 : 2;
  if (req.team1PlayerIds.length !== size || req.team2PlayerIds.length !== size)
    throw badRequest(
      req.matchType === 'Singles'
        ? 'Singles matches need exactly one player per side.'
        : 'Doubles matches need exactly two players per side.',
    );

  const all = [...req.team1PlayerIds, ...req.team2PlayerIds];
  if (new Set(all).size !== all.length) throw badRequest('A player can only appear once in a match.');

  if (req.category === 'Mixed' && req.matchType !== 'Doubles')
    throw badRequest('Mixed category is only available for doubles.');

  const rows = await db.query('SELECT "Id", "FullName", "Gender", "IsActive", "PhotoUpdatedAt" FROM "Players" WHERE "Id" = ANY($1::int[])', [all]);
  const players = new Map(rows.map((p) => [p.Id, p]));

  const missing = all.filter((id) => !players.has(id));
  if (missing.length) throw badRequest(`Unknown player id(s): ${missing.join(', ')}.`);

  const inactive = all
    .map((id) => players.get(id))
    .filter((p) => !p.IsActive && !(existingIds && existingIds.has(p.Id)))
    .map((p) => p.FullName);
  if (inactive.length) throw badRequest(`Inactive player(s): ${inactive.join(', ')}.`);

  const list = all.map((id) => players.get(id));
  if (req.category === 'Mens' && list.some((p) => p.Gender !== 'Male'))
    throw badRequest("Men's matches can only include male players.");
  if (req.category === 'Womens' && list.some((p) => p.Gender !== 'Female'))
    throw badRequest("Women's matches can only include female players.");
  if (req.category === 'Mixed') {
    for (const team of [req.team1PlayerIds, req.team2PlayerIds]) {
      const genders = team.map((id) => players.get(id).Gender);
      if (!(genders.includes('Male') && genders.includes('Female')))
        throw badRequest('Each mixed doubles team needs one male and one female player.');
    }
  }
  return players;
}

function validateScore(t1, t2, playedAt) {
  if (t1 === t2) throw badRequest('Pickleball matches cannot end in a tie.');
  if (t1 < 0 || t2 < 0) throw badRequest('Scores cannot be negative.');
  if (inFuture(playedAt)) throw badRequest('Cannot record a result for a match dated in the future.');
}

/** Inserts or updates the result row and marks the match completed (in memory and in the DB). */
async function applyResult(t, match, t1, t2, userId) {
  const winner = t1 > t2 ? 1 : 2;
  const now = new Date();
  if (!match.result) {
    await t.query(
      `INSERT INTO "MatchResults" ("MatchId", "Team1Score", "Team2Score", "WinningTeam", "RecordedByUserId", "RecordedAt")
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [match.id, t1, t2, winner, userId, now],
    );
    match.result = { team1Score: t1, team2Score: t2, winningTeam: winner, recordedAt: now, updatedAt: null };
  } else {
    await t.query(
      `UPDATE "MatchResults" SET "Team1Score" = $2, "Team2Score" = $3, "WinningTeam" = $4, "UpdatedByUserId" = $5, "UpdatedAt" = $6
       WHERE "MatchId" = $1`,
      [match.id, t1, t2, winner, userId, now],
    );
    Object.assign(match.result, { team1Score: t1, team2Score: t2, winningTeam: winner, updatedAt: now });
  }
  match.status = 'Completed';
}

async function saveMatchRow(t, match) {
  await t.query(
    `UPDATE "Matches" SET "MatchType" = $2, "Category" = $3, "Status" = $4, "PlayedAt" = $5, "Location" = $6, "Notes" = $7, "UpdatedAt" = $8
     WHERE "Id" = $1`,
    [match.id, match.matchType, match.category, match.status, match.playedAt, match.location, match.notes, match.updatedAt],
  );
}

async function addHistory(t, matchId, action, userId, reason, previous, next) {
  await t.query(
    `INSERT INTO "MatchResultHistory" ("MatchId", "Action", "ChangedByUserId", "ChangedAt", "Reason", "PreviousValues", "NewValues")
     VALUES ($1, $2, $3, now(), $4, $5::jsonb, $6::jsonb)`,
    [matchId, action, userId, reason, previous, next],
  );
}

async function loadForUpdate(t, id) {
  const locked = await t.one('SELECT "Id" FROM "Matches" WHERE "Id" = $1 FOR UPDATE', [id]);
  if (!locked) throw notFound('Match not found.');
  return loadMatch(t, id);
}

// ------------------------------------------------------------------ queries

async function list(ctx) {
  const q = readQuery(ctx.query, {
    status: { type: 'enum', values: Enums.MatchStatus },
    matchType: { type: 'enum', values: Enums.MatchFormat },
    category: { type: 'enum', values: Enums.MatchCategory },
    playerId: { type: 'int' },
    from: { type: 'date' },
    to: { type: 'date' },
    page: { type: 'int', default: 1 },
    pageSize: { type: 'int', default: 20 },
  });
  const page = Math.max(1, q.page);
  const pageSize = clamp(q.pageSize, 1, 100);

  const where = [];
  const params = [];
  const add = (sql, value) => {
    params.push(value);
    where.push(sql.replace('?', `$${params.length}`));
  };

  if (q.status) {
    if (q.status === 'Cancelled' && !ctx.user?.isAdmin) throw forbidden();
    add('m."Status" = ?', q.status);
  } else {
    where.push(`m."Status" <> 'Cancelled'`);
  }
  if (q.matchType) add('m."MatchType" = ?', q.matchType);
  if (q.category) add('m."Category" = ?', q.category);
  if (q.playerId !== null)
    add('EXISTS (SELECT 1 FROM "MatchParticipants" mp WHERE mp."MatchId" = m."Id" AND mp."PlayerId" = ?)', q.playerId);
  if (q.from) add('m."PlayedAt" >= ?', q.from);
  if (q.to) add('m."PlayedAt" <= ?', q.to);

  const filter = `WHERE ${where.join(' AND ')}`;
  const total = await ctx.db.scalar(`SELECT count(*)::int FROM "Matches" m ${filter}`, params);
  const ids = await ctx.db.query(
    `SELECT m."Id" FROM "Matches" m ${filter} ORDER BY m."PlayedAt" DESC, m."Id" DESC OFFSET ${(page - 1) * pageSize} LIMIT ${pageSize}`,
    params,
  );
  const items = await loadMatches(ctx.db, ids.map((r) => r.Id));
  return paged(items.map(matchDto), page, pageSize, total);
}

async function get(ctx) {
  const match = await loadMatch(ctx.db, ctx.params.id);
  if (!match || (match.status === 'Cancelled' && !ctx.user?.isAdmin)) throw notFound('Match not found.');
  return matchDto(match);
}

async function history(ctx) {
  const id = ctx.params.id;
  if (!(await ctx.db.scalar('SELECT EXISTS (SELECT 1 FROM "Matches" WHERE "Id" = $1)', [id]))) throw notFound('Match not found.');

  const rows = await ctx.db.query(
    `SELECT h."Id", h."Action", h."ChangedAt", u."Email", h."Reason", h."PreviousValues", h."NewValues"
     FROM "MatchResultHistory" h JOIN "Users" u ON u."Id" = h."ChangedByUserId"
     WHERE h."MatchId" = $1 ORDER BY h."ChangedAt" DESC, h."Id" DESC`,
    [id],
  );
  return rows.map((h) => ({
    id: Number(h.Id),
    action: h.Action,
    changedAt: new Date(h.ChangedAt).toISOString(),
    changedBy: h.Email,
    reason: h.Reason,
    previousValues: h.PreviousValues ?? null,
    newValues: h.NewValues ?? null,
  }));
}

// ------------------------------------------------------------------ commands (admin only)

async function create(ctx) {
  const userId = ctx.user.userId;
  const req = validate(await ctx.json(), upsertSpec);
  const players = await validateLineup(ctx.db, req, null);
  if (req.result) validateScore(req.result.team1Score, req.result.team2Score, req.playedAt);

  const match = await ctx.db.tx(async (t) => {
    const now = new Date();
    const row = await t.one(
      `INSERT INTO "Matches" ("MatchType", "Category", "Status", "PlayedAt", "Location", "Notes", "CreatedByUserId", "CreatedAt", "UpdatedAt")
       VALUES ($1, $2, 'Scheduled', $3, $4, $5, $6, $7, $7) RETURNING "Id"`,
      [req.matchType, req.category, req.playedAt, clean(req.location), clean(req.notes), userId, now],
    );

    const m = {
      id: row.Id,
      matchType: req.matchType,
      category: req.category,
      status: 'Scheduled',
      playedAt: req.playedAt,
      location: clean(req.location),
      notes: clean(req.notes),
      createdAt: now,
      updatedAt: now,
      participants: [],
      result: null,
    };

    const lineup = [...req.team1PlayerIds.map((id) => [id, 1]), ...req.team2PlayerIds.map((id) => [id, 2])];
    for (const [pid, team] of lineup) {
      const p = await t.one('INSERT INTO "MatchParticipants" ("MatchId", "PlayerId", "Team") VALUES ($1, $2, $3) RETURNING "Id"', [m.id, pid, team]);
      const pl = players.get(pid);
      m.participants.push({ id: p.Id, playerId: pid, team, fullName: pl.FullName, gender: pl.Gender, photoUpdatedAt: pl.PhotoUpdatedAt });
    }

    if (req.result) {
      await applyResult(t, m, req.result.team1Score, req.result.team2Score, userId);
      await t.query('UPDATE "Matches" SET "Status" = $2 WHERE "Id" = $1', [m.id, m.status]);
    }

    await addHistory(t, m.id, 'MatchCreated', userId, null, null, snapshot(m));
    if (m.status === 'Completed') await recalculate(t);
    return m;
  });

  return { $status: 201, $body: matchDto(match), $headers: { Location: `/api/matches/${match.id}` } };
}

async function update(ctx) {
  const userId = ctx.user.userId;
  const id = ctx.params.id;
  const req = validate(await ctx.json(), upsertSpec);

  const match = await ctx.db.tx(async (t) => {
    const m = await loadForUpdate(t, id);
    if (m.status === 'Cancelled') throw badRequest('Restore the match before editing it.');

    const hadResult = m.result !== null;
    if (hadResult && !clean(req.reason))
      throw badRequest('A reason is required when editing a match that already has a result.');

    const currentIds = new Set(m.participants.map((p) => p.playerId));
    const players = await validateLineup(t, req, currentIds);

    if (hadResult && inFuture(req.playedAt)) throw badRequest('A completed match cannot be dated in the future.');

    const before = snapshot(m);

    m.matchType = req.matchType;
    m.category = req.category;
    m.playedAt = req.playedAt;
    m.location = clean(req.location);
    m.notes = clean(req.notes);
    m.updatedAt = new Date();

    // Sync participants: drop removed players, move kept ones, add new ones.
    const desired = new Map([...req.team1PlayerIds.map((pid) => [pid, 1]), ...req.team2PlayerIds.map((pid) => [pid, 2])]);
    for (const p of [...m.participants]) {
      if (!desired.has(p.playerId)) {
        await t.query('DELETE FROM "MatchParticipants" WHERE "Id" = $1', [p.id]);
        m.participants.splice(m.participants.indexOf(p), 1);
      } else if (p.team !== desired.get(p.playerId)) {
        p.team = desired.get(p.playerId);
        await t.query('UPDATE "MatchParticipants" SET "Team" = $2 WHERE "Id" = $1', [p.id, p.team]);
      }
    }
    const existing = new Set(m.participants.map((p) => p.playerId));
    for (const [pid, team] of desired) {
      if (existing.has(pid)) continue;
      const row = await t.one('INSERT INTO "MatchParticipants" ("MatchId", "PlayerId", "Team") VALUES ($1, $2, $3) RETURNING "Id"', [m.id, pid, team]);
      const pl = players.get(pid);
      m.participants.push({ id: row.Id, playerId: pid, team, fullName: pl.FullName, gender: pl.Gender, photoUpdatedAt: pl.PhotoUpdatedAt });
    }

    // Scores can only be changed through the result endpoint (with its own audit entry),
    // but a result can be added here when the match didn't have one yet.
    if (!hadResult && req.result) {
      validateScore(req.result.team1Score, req.result.team2Score, req.playedAt);
      await applyResult(t, m, req.result.team1Score, req.result.team2Score, userId);
    }

    await saveMatchRow(t, m);
    await addHistory(t, m.id, 'MatchUpdated', userId, clean(req.reason), before, snapshot(m));
    if (m.status === 'Completed') await recalculate(t);
    return m;
  });

  return matchDto(match);
}

/** Record a result, or correct an existing one (reason required). Rankings are recalculated. */
async function recordResult(ctx) {
  const userId = ctx.user.userId;
  const req = validate(await ctx.json(), { ...scoreFields, ...reasonSpec });

  const match = await ctx.db.tx(async (t) => {
    const m = await loadForUpdate(t, ctx.params.id);
    if (m.status === 'Cancelled') throw badRequest('Cannot record a result for a cancelled match.');

    const { team1Score: t1, team2Score: t2 } = req;
    validateScore(t1, t2, m.playedAt);

    const isCorrection = m.result !== null;
    if (isCorrection && !clean(req.reason)) throw badRequest('A reason is required when correcting a recorded result.');
    if (isCorrection && m.result.team1Score === t1 && m.result.team2Score === t2)
      throw badRequest('The new score is the same as the recorded score.');

    const before = snapshot(m);
    await applyResult(t, m, t1, t2, userId);
    m.updatedAt = new Date();
    await saveMatchRow(t, m);

    await addHistory(t, m.id, isCorrection ? 'ResultCorrected' : 'ResultRecorded', userId, clean(req.reason), before, snapshot(m));
    await recalculate(t);
    return m;
  });

  return matchDto(match);
}

async function cancel(ctx) {
  const userId = ctx.user.userId;
  const req = validate(await ctx.json(), reasonSpec);

  const match = await ctx.db.tx(async (t) => {
    const m = await loadForUpdate(t, ctx.params.id);
    if (m.status === 'Cancelled') throw badRequest('Match is already cancelled.');
    if (m.result && !clean(req.reason)) throw badRequest('A reason is required to cancel a match that has a result.');

    const before = snapshot(m);
    const wasCompleted = m.status === 'Completed';
    m.status = 'Cancelled';
    m.updatedAt = new Date();
    await saveMatchRow(t, m);
    await addHistory(t, m.id, 'MatchCancelled', userId, clean(req.reason), before, snapshot(m));
    if (wasCompleted) await recalculate(t);
    return m;
  });

  return matchDto(match);
}

async function restore(ctx) {
  const userId = ctx.user.userId;
  const req = validate(await ctx.json(), reasonSpec);

  const match = await ctx.db.tx(async (t) => {
    const m = await loadForUpdate(t, ctx.params.id);
    if (m.status !== 'Cancelled') throw badRequest('Match is not cancelled.');

    const before = snapshot(m);
    m.status = m.result ? 'Completed' : 'Scheduled';
    m.updatedAt = new Date();
    await saveMatchRow(t, m);
    await addHistory(t, m.id, 'MatchRestored', userId, clean(req.reason), before, snapshot(m));
    if (m.status === 'Completed') await recalculate(t);
    return m;
  });

  return matchDto(match);
}

export default [
  { method: 'GET', path: '/api/matches', handler: list },
  { method: 'GET', path: '/api/matches/:id', handler: get },
  { method: 'GET', path: '/api/matches/:id/history', handler: history, auth: 'admin' },
  { method: 'POST', path: '/api/matches', handler: create, auth: 'admin' },
  { method: 'PUT', path: '/api/matches/:id', handler: update, auth: 'admin' },
  { method: 'PUT', path: '/api/matches/:id/result', handler: recordResult, auth: 'admin' },
  { method: 'POST', path: '/api/matches/:id/cancel', handler: cancel, auth: 'admin' },
  { method: 'POST', path: '/api/matches/:id/restore', handler: restore, auth: 'admin' },
];

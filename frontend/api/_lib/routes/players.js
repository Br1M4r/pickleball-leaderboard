import Busboy from 'busboy';
import { hashPassword } from '../auth.js';
import { HttpError, ValidationError, badRequest, conflict, forbidden, notFound } from '../http.js';
import { LEADERBOARD_SELECT, leaderboardRow, loadMatches, matchDto, paged, playerDto } from '../mapping.js';
import { recalculate, winPctHundredths } from '../ranking.js';
import { Enums, clamp, profileFields, readQuery, validate } from '../validate.js';

const MAX_PHOTO_BYTES = 2 * 1024 * 1024;

const PLAYER_SELECT = `SELECT p.*, u."Email" AS "UserEmail" FROM "Players" p LEFT JOIN "Users" u ON u."Id" = p."UserId"`;

// ------------------------------------------------------------------ helpers

function ensureCanEdit(ctx, playerId) {
  if (ctx.user.isAdmin) return;
  if (ctx.user.playerId !== playerId) throw forbidden();
}

async function loadVisiblePlayer(ctx, id) {
  const player = await ctx.db.one(`${PLAYER_SELECT} WHERE p."Id" = $1`, [id]);
  if (!player) throw notFound('Player not found.');
  const canSeeInactive = ctx.user?.isAdmin || (ctx.user && ctx.user.playerId === id);
  if (!player.IsActive && !canSeeInactive) throw notFound('Player not found.');
  return player;
}

/** Career totals across every completed match, independent of ranking scope. */
async function computeTotals(db, playerId) {
  const rows = await db.query(
    `SELECT mp."Team", r."WinningTeam", r."Team1Score", r."Team2Score"
     FROM "MatchParticipants" mp
     JOIN "Matches" m ON m."Id" = mp."MatchId"
     JOIN "MatchResults" r ON r."MatchId" = m."Id"
     WHERE mp."PlayerId" = $1 AND m."Status" = 'Completed'
     ORDER BY m."PlayedAt", mp."MatchId"`,
    [playerId],
  );

  let wins = 0, losses = 0, pf = 0, pa = 0, streak = 0, longest = 0;
  for (const r of rows) {
    const mine = r.Team === 1 ? r.Team1Score : r.Team2Score;
    const theirs = r.Team === 1 ? r.Team2Score : r.Team1Score;
    pf += mine;
    pa += theirs;
    if (r.WinningTeam === r.Team) {
      wins++;
      streak++;
      longest = Math.max(longest, streak);
    } else {
      losses++;
      streak = 0;
    }
  }
  const played = wins + losses;
  return {
    matchesPlayed: played,
    wins,
    losses,
    winPercentage: winPctHundredths(wins, played) / 100,
    pointsFor: pf,
    pointsAgainst: pa,
    currentWinStreak: streak,
    longestWinStreak: longest,
  };
}

function detectImageType(b) {
  if (b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return 'image/gif';
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50)
    return 'image/webp';
  return null;
}

/** Extracts the "file" field from a multipart/form-data body. */
function readUploadedFile(headers, raw) {
  return new Promise((resolve, reject) => {
    let bb;
    try {
      bb = Busboy({ headers, limits: { files: 1, fileSize: MAX_PHOTO_BYTES + 1 } });
    } catch {
      reject(new ValidationError({ file: ['The file field is required.'] }));
      return;
    }
    let file = null;
    bb.on('file', (name, stream) => {
      if (name !== 'file' || file) {
        stream.resume();
        return;
      }
      const chunks = [];
      stream.on('data', (c) => chunks.push(c));
      stream.on('end', () => {
        file = Buffer.concat(chunks);
      });
    });
    bb.on('error', reject);
    bb.on('close', () => resolve(file));
    bb.end(raw);
  });
}

// ------------------------------------------------------------------ queries

async function list(ctx) {
  const q = readQuery(ctx.query, {
    search: { type: 'string' },
    gender: { type: 'enum', values: Enums.Gender },
    skillLevel: { type: 'enum', values: Enums.SkillLevel },
    category: { type: 'enum', values: Enums.PlayingCategory },
    includeInactive: { type: 'bool', default: false },
    page: { type: 'int', default: 1 },
    pageSize: { type: 'int', default: 20 },
  });
  const page = Math.max(1, q.page);
  const pageSize = clamp(q.pageSize, 1, 100);
  const isAdmin = Boolean(ctx.user?.isAdmin);

  const where = [];
  const params = [];
  if (!(q.includeInactive && isAdmin)) where.push('p."IsActive"');
  if (q.search && q.search.trim()) {
    params.push(`%${q.search.trim()}%`);
    const n = params.length;
    where.push(isAdmin ? `(p."FullName" ILIKE $${n} OR u."Email" ILIKE $${n})` : `p."FullName" ILIKE $${n}`);
  }
  for (const [col, val] of [['Gender', q.gender], ['SkillLevel', q.skillLevel], ['PlayingCategory', q.category]]) {
    if (val) {
      params.push(val);
      where.push(`p."${col}" = $${params.length}`);
    }
  }
  const filter = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const total = await ctx.db.scalar(
    `SELECT count(*)::int FROM "Players" p LEFT JOIN "Users" u ON u."Id" = p."UserId" ${filter}`,
    params,
  );
  const rows = await ctx.db.query(
    `${PLAYER_SELECT} ${filter} ORDER BY p."FullName" OFFSET ${(page - 1) * pageSize} LIMIT ${pageSize}`,
    params,
  );
  return paged(rows.map((p) => playerDto(p, isAdmin)), page, pageSize, total);
}

async function get(ctx) {
  const id = ctx.params.id;
  const player = await loadVisiblePlayer(ctx, id);

  const [standings, recentIds, totals] = await Promise.all([
    ctx.db.query(`${LEADERBOARD_SELECT} WHERE e."PlayerId" = $1`, [id]),
    ctx.db.query(
      `SELECT m."Id" FROM "Matches" m
       WHERE m."Status" <> 'Cancelled' AND EXISTS (SELECT 1 FROM "MatchParticipants" mp WHERE mp."MatchId" = m."Id" AND mp."PlayerId" = $1)
       ORDER BY m."PlayedAt" DESC, m."Id" DESC LIMIT 10`,
      [id],
    ),
    computeTotals(ctx.db, id),
  ]);
  const recent = await loadMatches(ctx.db, recentIds.map((r) => r.Id));
  const order = (s) => Enums.LeaderboardScope.indexOf(s.Scope);

  return {
    player: playerDto(player, Boolean(ctx.user?.isAdmin)),
    standings: standings.sort((a, b) => order(a) - order(b)).map(leaderboardRow),
    recentMatches: recent.map(matchDto),
    totals,
  };
}

async function matches(ctx) {
  const id = ctx.params.id;
  await loadVisiblePlayer(ctx, id);
  const q = readQuery(ctx.query, { page: { type: 'int', default: 1 }, pageSize: { type: 'int', default: 20 } });
  const page = Math.max(1, q.page);
  const pageSize = clamp(q.pageSize, 1, 100);

  const filter = `WHERE m."Status" <> 'Cancelled' AND EXISTS (SELECT 1 FROM "MatchParticipants" mp WHERE mp."MatchId" = m."Id" AND mp."PlayerId" = $1)`;
  const total = await ctx.db.scalar(`SELECT count(*)::int FROM "Matches" m ${filter}`, [id]);
  const ids = await ctx.db.query(
    `SELECT m."Id" FROM "Matches" m ${filter} ORDER BY m."PlayedAt" DESC, m."Id" DESC OFFSET ${(page - 1) * pageSize} LIMIT ${pageSize}`,
    [id],
  );
  const items = await loadMatches(ctx.db, ids.map((r) => r.Id));
  return paged(items.map(matchDto), page, pageSize, total);
}

async function photo(ctx) {
  const row = await ctx.db.one('SELECT "Data", "ContentType" FROM "PlayerPhotos" WHERE "PlayerId" = $1', [ctx.params.id]);
  if (!row) throw notFound('Photo not found.');
  return {
    $status: 200,
    $body: Buffer.from(row.Data),
    $headers: { 'Content-Type': row.ContentType, 'Cache-Control': 'public, max-age=86400' },
  };
}

// ------------------------------------------------------------------ admin commands

async function create(ctx) {
  const req = validate(await ctx.json(), {
    ...profileFields,
    email: { type: 'string', email: true, maxLength: 256 },
    password: { type: 'string', minLength: 8, maxLength: 128 },
  });

  const wantsAccount = Boolean(req.email?.trim()) || Boolean(req.password?.trim());
  if (wantsAccount && (!req.email?.trim() || !req.password?.trim()))
    throw badRequest('Provide both email and password to create a login for this player.');

  const id = await ctx.db.tx(async (t) => {
    let userId = null;
    if (wantsAccount) {
      const email = req.email.trim().toLowerCase();
      if (await t.scalar('SELECT EXISTS (SELECT 1 FROM "Users" WHERE "Email" = $1)', [email]))
        throw conflict('An account with this email already exists.');
      const user = await t.one(
        `INSERT INTO "Users" ("Email", "PasswordHash", "Role", "IsActive", "CreatedAt")
         VALUES ($1, $2, 'Player', TRUE, now()) RETURNING "Id"`,
        [email, await hashPassword(req.password)],
      );
      userId = user.Id;
    }
    const player = await t.one(
      `INSERT INTO "Players" ("UserId", "FullName", "Gender", "Age", "SkillLevel", "PlayingCategory",
         "DateRegistered", "UpdatedAt", "IsActive")
       VALUES ($1, $2, $3, $4, $5, $6, now(), now(), TRUE) RETURNING "Id"`,
      [userId, req.fullName.trim(), req.gender, req.age, req.skillLevel, req.playingCategory],
    );
    return player.Id;
  });

  const player = await ctx.db.one(`${PLAYER_SELECT} WHERE p."Id" = $1`, [id]);
  return { $status: 201, $body: playerDto(player, true), $headers: { Location: `/api/players/${id}` } };
}

async function update(ctx) {
  const req = validate(await ctx.json(), profileFields);
  const updated = await ctx.db.one(
    `UPDATE "Players" SET "FullName" = $2, "Gender" = $3, "Age" = $4, "SkillLevel" = $5, "PlayingCategory" = $6, "UpdatedAt" = now()
     WHERE "Id" = $1 RETURNING "Id"`,
    [ctx.params.id, req.fullName.trim(), req.gender, req.age, req.skillLevel, req.playingCategory],
  );
  if (!updated) throw notFound('Player not found.');
  return playerDto(await ctx.db.one(`${PLAYER_SELECT} WHERE p."Id" = $1`, [ctx.params.id]), true);
}

/** Activate or deactivate a player (and their login). Inactive players are removed from rankings. */
async function setStatus(ctx) {
  const req = validate(await ctx.json(), { isActive: { type: 'bool', default: false } });
  const id = ctx.params.id;

  await ctx.db.tx(async (t) => {
    const player = await t.one(
      `SELECT p."Id", p."UserId", u."Role" AS "UserRole" FROM "Players" p LEFT JOIN "Users" u ON u."Id" = p."UserId" WHERE p."Id" = $1`,
      [id],
    );
    if (!player) throw notFound('Player not found.');
    if (player.UserRole === 'Admin' && player.UserId === ctx.user.userId && !req.isActive)
      throw badRequest('You cannot deactivate your own account.');

    await t.query('UPDATE "Players" SET "IsActive" = $2, "UpdatedAt" = now() WHERE "Id" = $1', [id, req.isActive]);
    if (player.UserId !== null) await t.query('UPDATE "Users" SET "IsActive" = $2 WHERE "Id" = $1', [player.UserId, req.isActive]);
    await recalculate(t);
  });

  return playerDto(await ctx.db.one(`${PLAYER_SELECT} WHERE p."Id" = $1`, [id]), true);
}

// ------------------------------------------------------------------ self-service

async function updateMe(ctx) {
  const playerId = ctx.user.playerId;
  if (playerId === null) throw badRequest('Your account has no player profile.');
  const req = validate(await ctx.json(), {
    fullName: profileFields.fullName,
    age: profileFields.age,
    playingCategory: profileFields.playingCategory,
  });
  const player = await ctx.db.one(
    `UPDATE "Players" SET "FullName" = $2, "Age" = $3, "PlayingCategory" = $4, "UpdatedAt" = now()
     WHERE "Id" = $1 RETURNING *`,
    [playerId, req.fullName.trim(), req.age, req.playingCategory],
  );
  if (!player) throw notFound('Player not found.');
  return playerDto(player);
}

async function uploadPhoto(ctx) {
  const id = ctx.params.id;
  ensureCanEdit(ctx, id);

  const contentType = ctx.req.headers['content-type'] || '';
  if (!contentType.toLowerCase().startsWith('multipart/form-data'))
    throw new ValidationError({ file: ['The file field is required.'] });

  const raw = await ctx.raw();
  if (raw.length > MAX_PHOTO_BYTES + 64 * 1024) throw new HttpError(413, 'Image must be 2 MB or smaller.');

  const bytes = await readUploadedFile(ctx.req.headers, raw);
  if (!bytes) throw new ValidationError({ file: ['The file field is required.'] });
  if (bytes.length === 0) throw badRequest('Choose an image to upload.');
  if (bytes.length > MAX_PHOTO_BYTES) throw badRequest('Image must be 2 MB or smaller.');

  const type = detectImageType(bytes);
  if (!type) throw badRequest('Only JPEG, PNG, GIF or WEBP images are allowed.');

  const player = await ctx.db.tx(async (t) => {
    const exists = await t.one('SELECT "Id" FROM "Players" WHERE "Id" = $1 FOR UPDATE', [id]);
    if (!exists) throw notFound('Player not found.');
    await t.query(
      `INSERT INTO "PlayerPhotos" ("PlayerId", "Data", "ContentType", "UpdatedAt") VALUES ($1, $2, $3, now())
       ON CONFLICT ("PlayerId") DO UPDATE SET "Data" = EXCLUDED."Data", "ContentType" = EXCLUDED."ContentType", "UpdatedAt" = EXCLUDED."UpdatedAt"`,
      [id, bytes, type],
    );
    return t.one('UPDATE "Players" SET "PhotoUpdatedAt" = now() WHERE "Id" = $1 RETURNING *', [id]);
  });

  // Same as the original: account id is shown to admins, the email isn't loaded here.
  return playerDto(player, ctx.user.isAdmin);
}

async function deletePhoto(ctx) {
  const id = ctx.params.id;
  ensureCanEdit(ctx, id);
  await ctx.db.tx(async (t) => {
    const player = await t.one('UPDATE "Players" SET "PhotoUpdatedAt" = NULL WHERE "Id" = $1 RETURNING "Id"', [id]);
    if (!player) throw notFound('Player not found.');
    await t.query('DELETE FROM "PlayerPhotos" WHERE "PlayerId" = $1', [id]);
  });
  return null;
}

export default [
  { method: 'GET', path: '/api/players', handler: list },
  { method: 'PUT', path: '/api/players/me', handler: updateMe, auth: 'user' },
  { method: 'GET', path: '/api/players/:id', handler: get },
  { method: 'GET', path: '/api/players/:id/matches', handler: matches },
  { method: 'GET', path: '/api/players/:id/photo', handler: photo },
  { method: 'POST', path: '/api/players', handler: create, auth: 'admin' },
  { method: 'PUT', path: '/api/players/:id', handler: update, auth: 'admin' },
  { method: 'PATCH', path: '/api/players/:id/status', handler: setStatus, auth: 'admin' },
  { method: 'POST', path: '/api/players/:id/photo', handler: uploadPhoto, auth: 'user', rawBody: true },
  { method: 'DELETE', path: '/api/players/:id/photo', handler: deletePhoto, auth: 'user' },
];

import { hashPassword } from '../auth.js';
import { badRequest, conflict, notFound } from '../http.js';
import { USER_SELECT, paged, userDto } from '../mapping.js';
import { recalculate } from '../ranking.js';
import { Enums, clamp, emailField, newPasswordField, readQuery, validate } from '../validate.js';

/** Admin management of login accounts. */
async function list(ctx) {
  const q = readQuery(ctx.query, {
    search: { type: 'string' },
    role: { type: 'enum', values: Enums.UserRole },
    page: { type: 'int', default: 1 },
    pageSize: { type: 'int', default: 20 },
  });
  const page = Math.max(1, q.page);
  const pageSize = clamp(q.pageSize, 1, 100);

  const where = [];
  const params = [];
  if (q.search && q.search.trim()) {
    params.push(`%${q.search.trim()}%`);
    where.push(`(u."Email" ILIKE $${params.length} OR p."FullName" ILIKE $${params.length})`);
  }
  if (q.role) {
    params.push(q.role);
    where.push(`u."Role" = $${params.length}`);
  }
  const filter = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const total = await ctx.db.scalar(
    `SELECT count(*)::int FROM "Users" u LEFT JOIN "Players" p ON p."UserId" = u."Id" ${filter}`,
    params,
  );
  const rows = await ctx.db.query(
    `${USER_SELECT} ${filter} ORDER BY u."Email" OFFSET ${(page - 1) * pageSize} LIMIT ${pageSize}`,
    params,
  );
  return paged(rows.map(userDto), page, pageSize, total);
}

async function create(ctx) {
  const req = validate(await ctx.json(), {
    email: emailField,
    password: newPasswordField,
    role: { type: 'enum', values: Enums.UserRole, required: true },
    playerId: { type: 'int' },
  });
  const email = req.email.trim().toLowerCase();

  const id = await ctx.db.tx(async (t) => {
    if (await t.scalar('SELECT EXISTS (SELECT 1 FROM "Users" WHERE "Email" = $1)', [email]))
      throw conflict('An account with this email already exists.');

    let player = null;
    if (req.playerId !== null) {
      player = await t.one('SELECT "Id", "UserId" FROM "Players" WHERE "Id" = $1 FOR UPDATE', [req.playerId]);
      if (!player) throw notFound('Player not found.');
      if (player.UserId !== null) throw conflict('That player already has an account.');
    }

    const user = await t.one(
      `INSERT INTO "Users" ("Email", "PasswordHash", "Role", "IsActive", "CreatedAt")
       VALUES ($1, $2, $3, TRUE, now()) RETURNING "Id"`,
      [email, await hashPassword(req.password), req.role],
    );
    if (player) await t.query('UPDATE "Players" SET "UserId" = $2 WHERE "Id" = $1', [player.Id, user.Id]);
    return user.Id;
  });

  return userDto(await ctx.db.one(`${USER_SELECT} WHERE u."Id" = $1`, [id]));
}

async function update(ctx) {
  const id = ctx.params.id;
  const req = validate(await ctx.json(), {
    email: emailField,
    role: { type: 'enum', values: Enums.UserRole, required: true },
    isActive: { type: 'bool', default: true },
  });

  const saved = await ctx.db.tx(async (t) => {
    const user = await t.one(`${USER_SELECT} WHERE u."Id" = $1`, [id]);
    if (!user) throw notFound('User not found.');

    const isSelf = id === ctx.user.userId;
    if (isSelf && (!req.isActive || req.role !== 'Admin'))
      throw badRequest('You cannot deactivate or demote your own account.');

    if (user.Role === 'Admin' && (req.role !== 'Admin' || !req.isActive)) {
      const others = await t.scalar(
        `SELECT count(*)::int FROM "Users" WHERE "Role" = 'Admin' AND "IsActive" AND "Id" <> $1`,
        [id],
      );
      if (others === 0) throw badRequest('At least one active administrator is required.');
    }

    const email = req.email.trim().toLowerCase();
    if (email !== user.Email && (await t.scalar('SELECT EXISTS (SELECT 1 FROM "Users" WHERE "Email" = $1 AND "Id" <> $2)', [email, id])))
      throw conflict('An account with this email already exists.');

    const activeChanged = user.IsActive !== req.isActive;
    await t.query('UPDATE "Users" SET "Email" = $2, "Role" = $3, "IsActive" = $4 WHERE "Id" = $1', [id, email, req.role, req.isActive]);

    if (activeChanged && user.PlayerId !== null) {
      await t.query('UPDATE "Players" SET "IsActive" = $2, "UpdatedAt" = now() WHERE "Id" = $1', [user.PlayerId, req.isActive]);
      await recalculate(t);
    }
    return { ...user, Email: email, Role: req.role, IsActive: req.isActive };
  });

  return userDto(saved);
}

async function resetPassword(ctx) {
  const req = validate(await ctx.json(), { newPassword: newPasswordField });
  const user = await ctx.db.one('SELECT "Id" FROM "Users" WHERE "Id" = $1', [ctx.params.id]);
  if (!user) throw notFound('User not found.');
  await ctx.db.query('UPDATE "Users" SET "PasswordHash" = $2 WHERE "Id" = $1', [user.Id, await hashPassword(req.newPassword)]);
  return null;
}

export default [
  { method: 'GET', path: '/api/users', handler: list, auth: 'admin' },
  { method: 'POST', path: '/api/users', handler: create, auth: 'admin' },
  { method: 'PUT', path: '/api/users/:id', handler: update, auth: 'admin' },
  { method: 'POST', path: '/api/users/:id/reset-password', handler: resetPassword, auth: 'admin' },
];

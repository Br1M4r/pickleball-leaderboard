import { createToken, hashPassword, verifyPassword } from '../auth.js';
import { badRequest, conflict, forbidden, notFound, unauthorized } from '../http.js';
import { USER_SELECT, userDto } from '../mapping.js';
import { emailField, newPasswordField, profileFields, validate } from '../validate.js';

async function loadUser(db, id) {
  return db.one(`${USER_SELECT} WHERE u."Id" = $1`, [id]);
}

/** Self-registration creates a Player account and its player profile. */
async function register(ctx) {
  const req = validate(await ctx.json(), { email: emailField, password: newPasswordField, ...profileFields });
  const email = req.email.trim().toLowerCase();

  const result = await ctx.db.tx(async (t) => {
    if (await t.scalar('SELECT EXISTS (SELECT 1 FROM "Users" WHERE "Email" = $1)', [email]))
      throw conflict('An account with this email already exists.');

    const user = await t.one(
      `INSERT INTO "Users" ("Email", "PasswordHash", "Role", "IsActive", "CreatedAt", "LastLoginAt")
       VALUES ($1, $2, 'Player', TRUE, now(), now()) RETURNING *`,
      [email, await hashPassword(req.password)],
    );
    const player = await t.one(
      `INSERT INTO "Players" ("UserId", "FullName", "Gender", "Age", "SkillLevel", "PlayingCategory",
         "DateRegistered", "UpdatedAt", "IsActive")
       VALUES ($1, $2, $3, $4, $5, $6, now(), now(), TRUE) RETURNING "Id", "FullName"`,
      [user.Id, req.fullName.trim(), req.gender, req.age, req.skillLevel, req.playingCategory],
    );
    return { user: { ...user, PlayerId: player.Id, PlayerName: player.FullName }, playerId: player.Id };
  });

  const { token, expiresAt } = createToken({ id: result.user.Id, email, role: 'Player' }, result.playerId);
  return { token, expiresAt: expiresAt.toISOString(), user: userDto(result.user) };
}

async function login(ctx) {
  const req = validate(await ctx.json(), {
    email: emailField,
    password: { type: 'string', required: true, maxLength: 128 },
  });
  const email = req.email.trim().toLowerCase();
  const user = await ctx.db.one(`${USER_SELECT} WHERE u."Email" = $1`, [email]);

  // Same message for unknown email and wrong password to avoid account enumeration.
  const check = user ? await verifyPassword(req.password, user.PasswordHash) : { ok: false };
  if (!user || !check.ok) throw unauthorized('Invalid email or password.');
  if (!user.IsActive) throw forbidden('This account has been deactivated. Contact an administrator.');

  if (check.needsRehash) {
    await ctx.db.query('UPDATE "Users" SET "PasswordHash" = $2, "LastLoginAt" = now() WHERE "Id" = $1', [user.Id, await hashPassword(req.password)]);
  } else {
    await ctx.db.query('UPDATE "Users" SET "LastLoginAt" = now() WHERE "Id" = $1', [user.Id]);
  }
  user.LastLoginAt = new Date();

  const { token, expiresAt } = createToken({ id: user.Id, email: user.Email, role: user.Role }, user.PlayerId);
  return { token, expiresAt: expiresAt.toISOString(), user: userDto(user) };
}

async function me(ctx) {
  const user = await loadUser(ctx.db, ctx.user.userId);
  if (!user) throw notFound('User not found.');
  return userDto(user);
}

async function changePassword(ctx) {
  const req = validate(await ctx.json(), {
    currentPassword: { type: 'string', required: true },
    newPassword: newPasswordField,
  });
  const user = await ctx.db.one('SELECT "Id", "PasswordHash" FROM "Users" WHERE "Id" = $1', [ctx.user.userId]);
  if (!user) throw notFound('User not found.');
  if (!(await verifyPassword(req.currentPassword, user.PasswordHash)).ok)
    throw badRequest('Current password is incorrect.');

  await ctx.db.query('UPDATE "Users" SET "PasswordHash" = $2 WHERE "Id" = $1', [user.Id, await hashPassword(req.newPassword)]);
  return null;
}

export default [
  { method: 'POST', path: '/api/auth/register', handler: register, rateLimit: true },
  { method: 'POST', path: '/api/auth/login', handler: login, rateLimit: true },
  { method: 'GET', path: '/api/auth/me', handler: me, auth: 'user' },
  { method: 'POST', path: '/api/auth/change-password', handler: changePassword, auth: 'user' },
];

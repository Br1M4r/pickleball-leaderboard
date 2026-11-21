import crypto from 'node:crypto';
import { promisify } from 'node:util';
import jwt from 'jsonwebtoken';

const pbkdf2 = promisify(crypto.pbkdf2);

// ------------------------------------------------------------------ passwords
// Byte-compatible with ASP.NET Core Identity's PasswordHasher, so accounts created by the
// original .NET API keep working.
//   V3: 0x01 | prf(u32 BE) | iterations(u32 BE) | saltLen(u32 BE) | salt | subkey
//   V2: 0x00 | salt(16) | subkey(32)  (PBKDF2-HMAC-SHA1, 1000 iterations)

const ITERATIONS = 100_000;
const SALT_BYTES = 16;
const SUBKEY_BYTES = 32;
const PRF = { 0: 'sha1', 1: 'sha256', 2: 'sha512' };

export async function hashPassword(password) {
  const salt = crypto.randomBytes(SALT_BYTES);
  const subkey = await pbkdf2(password, salt, ITERATIONS, SUBKEY_BYTES, 'sha512');
  const header = Buffer.alloc(13);
  header.writeUInt8(0x01, 0);
  header.writeUInt32BE(2, 1); // HMACSHA512
  header.writeUInt32BE(ITERATIONS, 5);
  header.writeUInt32BE(SALT_BYTES, 9);
  return Buffer.concat([header, salt, subkey]).toString('base64');
}

/** Returns { ok, needsRehash }. */
export async function verifyPassword(password, stored) {
  let buf;
  try {
    buf = Buffer.from(stored || '', 'base64');
  } catch {
    return { ok: false, needsRehash: false };
  }
  if (buf.length === 0) return { ok: false, needsRehash: false };

  try {
    if (buf[0] === 0x00) {
      if (buf.length !== 1 + 16 + 32) return { ok: false, needsRehash: false };
      const salt = buf.subarray(1, 17);
      const expected = buf.subarray(17);
      const actual = await pbkdf2(password, salt, 1000, 32, 'sha1');
      const ok = crypto.timingSafeEqual(actual, expected);
      return { ok, needsRehash: ok };
    }

    if (buf[0] === 0x01) {
      const prf = buf.readUInt32BE(1);
      const iterations = buf.readUInt32BE(5);
      const saltLen = buf.readUInt32BE(9);
      const digest = PRF[prf];
      if (!digest || saltLen < 16 || buf.length < 13 + saltLen + 16) return { ok: false, needsRehash: false };
      const salt = buf.subarray(13, 13 + saltLen);
      const expected = buf.subarray(13 + saltLen);
      const actual = await pbkdf2(password, salt, iterations, expected.length, digest);
      const ok = crypto.timingSafeEqual(actual, expected);
      return { ok, needsRehash: ok && (iterations < ITERATIONS || prf !== 2) };
    }
  } catch {
    /* malformed hash */
  }
  return { ok: false, needsRehash: false };
}

// ------------------------------------------------------------------ tokens

function jwtOptions() {
  const secret = process.env.JWT_SECRET || process.env.Jwt__Secret || '';
  if (secret.length < 32) {
    throw new Error('JWT_SECRET must be set to a random string of at least 32 characters (Vercel > Settings > Environment Variables).');
  }
  const minutes = Number(process.env.JWT_EXPIRY_MINUTES || process.env.Jwt__ExpiryMinutes) || 480;
  return {
    secret,
    issuer: process.env.Jwt__Issuer || 'PickleballLeaderboard',
    audience: process.env.Jwt__Audience || 'PickleballLeaderboard.Client',
    minutes,
  };
}

export function createToken(user, playerId) {
  const o = jwtOptions();
  const now = Math.floor(Date.now() / 1000);
  const exp = now + o.minutes * 60;
  const payload = {
    sub: String(user.id),
    email: user.email,
    role: user.role,
    jti: crypto.randomUUID().replace(/-/g, ''),
    nbf: now,
    iat: now,
    exp,
    iss: o.issuer,
    aud: o.audience,
  };
  if (playerId !== null && playerId !== undefined) payload.player_id = String(playerId);
  const token = jwt.sign(payload, o.secret, { algorithm: 'HS256' });
  return { token, expiresAt: new Date(exp * 1000) };
}

/**
 * Resolves the caller from the Bearer token. Returns null for missing/invalid tokens and
 * for accounts that were deactivated or whose role changed after the token was issued.
 */
export async function authenticate(req, db) {
  const header = req.headers.authorization;
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) return null;

  const o = jwtOptions();
  let claims;
  try {
    claims = jwt.verify(header.slice(7).trim(), o.secret, {
      algorithms: ['HS256'],
      issuer: o.issuer,
      audience: o.audience,
      clockTolerance: 60,
    });
  } catch {
    return null;
  }

  const userId = Number.parseInt(claims.sub, 10);
  if (!Number.isInteger(userId)) return null;

  const row = await db.one('SELECT "IsActive", "Role" FROM "Users" WHERE "Id" = $1', [userId]);
  if (!row || !row.IsActive || row.Role !== claims.role) return null;

  const playerId = Number.parseInt(claims.player_id, 10);
  return {
    userId,
    email: claims.email,
    role: claims.role,
    playerId: Number.isInteger(playerId) ? playerId : null,
    isAdmin: claims.role === 'Admin',
  };
}

// Single Vercel serverless function serving the whole REST API (/api/*).
// vercel.json rewrites every /api/... request here; routing happens below.
// One function instead of one-per-endpoint keeps cold starts down and stays far
// below the Hobby plan's function limit.

import { authenticate } from './_lib/auth.js';
import { createDb } from './_lib/db.js';
import { ValidationError, forbidden, handleError, readRawBody, rateLimited, send, unauthorized } from './_lib/http.js';
import { ensureInitialized } from './_lib/schema.js';
import authRoutes from './_lib/routes/auth.js';
import dashboardRoutes from './_lib/routes/dashboard.js';
import leaderboardRoutes from './_lib/routes/leaderboard.js';
import matchRoutes from './_lib/routes/matches.js';
import playerRoutes from './_lib/routes/players.js';
import userRoutes from './_lib/routes/users.js';

const routes = [
  ...authRoutes,
  ...userRoutes,
  ...playerRoutes,
  ...matchRoutes,
  ...leaderboardRoutes,
  ...dashboardRoutes,
].map((r) => {
  const keys = [];
  const pattern = r.path.replace(/:(\w+)/g, (_, k) => {
    keys.push(k);
    return '(\\d+)';
  });
  return { ...r, keys, regex: new RegExp(`^${pattern}/?$`, 'i') };
});

/** Original request path: from the rewrite's ?__path= param, or the URL itself. */
function resolvePath(url) {
  const forwarded = url.searchParams.get('__path');
  if (forwarded !== null) return `/api/${forwarded.replace(/^\/+/, '')}`;
  return url.pathname;
}

function corsHeaders(req) {
  const allowed = (process.env.CORS_ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const origin = req.headers.origin;
  if (!origin || !allowed.includes(origin)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    Vary: 'Origin',
  };
}

async function health(res) {
  const report = {
    status: 'Unhealthy',
    hasDatabaseUrl: Boolean(process.env.DATABASE_URL),
    hasJwtSecret: (process.env.JWT_SECRET || process.env.Jwt__Secret || '').length >= 32,
    database: 'not checked',
  };
  const db = createDb();
  try {
    if (report.hasDatabaseUrl) {
      await ensureInitialized(db);
      report.userCount = await db.scalar('SELECT count(*)::int FROM "Users"');
      report.database = 'connected';
    }
    if (report.hasDatabaseUrl && report.hasJwtSecret) report.status = 'Healthy';
  } catch (err) {
    report.database = 'failed';
    report.error = err instanceof Error ? err.message : String(err);
  } finally {
    await db.end();
  }
  send(res, report.status === 'Healthy' ? 200 : 500, report, { 'Cache-Control': 'no-store' });
}

export default async function handler(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const path = resolvePath(url);
  const method = (req.method || 'GET').toUpperCase();
  for (const [k, v] of Object.entries(corsHeaders(req))) res.setHeader(k, v);

  if (method === 'OPTIONS') return send(res, 204, null);
  if (path === '/api' || path === '/api/') return send(res, 200, { name: 'Pickleball Leaderboard API', status: 'running' });
  if (path.toLowerCase() === '/api/health') return health(res);

  let params = null;
  let pathMatched = false;
  const route = routes.find((r) => {
    const m = r.regex.exec(path);
    if (!m) return false;
    pathMatched = true;
    if (r.method !== method) return false;
    params = Object.fromEntries(r.keys.map((k, i) => [k, Number(m[i + 1])]));
    return true;
  });

  if (!route) {
    return send(res, pathMatched ? 405 : 404, { title: pathMatched ? 'Method Not Allowed' : 'Not Found', status: pathMatched ? 405 : 404, instance: path });
  }

  if (route.rateLimit && rateLimited(req)) return send(res, 429, null, { 'Retry-After': '60' });

  const db = createDb();
  try {
    await ensureInitialized(db);

    const query = Object.fromEntries([...url.searchParams].filter(([k]) => k !== '__path'));
    let rawPromise = null;
    const raw = () => (rawPromise ??= readRawBody(req));

    const ctx = {
      req,
      db,
      params,
      query,
      user: await authenticate(req, db),
      raw,
      /** Parsed JSON body; a missing body counts as {}. */
      async json() {
        const buf = await raw();
        if (!buf.length) return {};
        try {
          return JSON.parse(buf.toString('utf8'));
        } catch {
          throw new ValidationError({ $: ['The request body is not valid JSON.'] });
        }
      },
    };

    if (route.auth && !ctx.user) throw unauthorized();
    if (route.auth === 'admin' && !ctx.user.isAdmin) throw forbidden();

    const result = await route.handler(ctx);
    if (result === null || result === undefined) return send(res, 204, null);
    if (result.$status) return send(res, result.$status, result.$body, result.$headers);
    return send(res, 200, result);
  } catch (err) {
    return handleError(res, err, path);
  } finally {
    await db.end();
  }
}

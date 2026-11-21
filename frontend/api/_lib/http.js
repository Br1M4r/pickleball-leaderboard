/** Expected errors that map to a specific HTTP status (same messages as the original API). */
export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** Field validation failures, returned as { errors: { Field: ["message"] } }. */
export class ValidationError extends Error {
  constructor(errors) {
    super('One or more validation errors occurred.');
    this.errors = errors;
  }
}

export const badRequest = (m) => new HttpError(400, m);
export const unauthorized = (m = 'Authentication is required.') => new HttpError(401, m);
export const forbidden = (m = 'You are not allowed to perform this action.') => new HttpError(403, m);
export const notFound = (m = 'Not found.') => new HttpError(404, m);
export const conflict = (m) => new HttpError(409, m);

const TITLES = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  409: 'Conflict',
  413: 'Payload Too Large',
  429: 'Too Many Requests',
  500: 'Server Error',
};

export function send(res, status, body, headers = {}) {
  if (res.headersSent) return;
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  if (body === undefined || body === null) {
    res.statusCode = status;
    res.end();
    return;
  }
  if (Buffer.isBuffer(body)) {
    res.statusCode = status;
    res.end(body);
    return;
  }
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

/** RFC 7807 problem response, the shape the frontend already understands. */
export function problem(res, status, detail, instance, extra = {}) {
  send(
    res,
    status,
    { title: TITLES[status] ?? 'Error', status, detail, instance, ...extra },
    { 'Content-Type': 'application/problem+json; charset=utf-8' },
  );
}

/** Converts any thrown error into a problem response without leaking internals. */
export function handleError(res, err, path) {
  if (err instanceof ValidationError) {
    return send(res, 400, {
      title: 'One or more validation errors occurred.',
      status: 400,
      errors: err.errors,
      instance: path,
    });
  }
  if (err instanceof HttpError) return problem(res, err.status, err.message, path);

  // PostgreSQL integrity violations (unique, foreign key, check) = conflicting data.
  if (typeof err?.code === 'string' && err.code.startsWith('23')) {
    console.warn('Database update failed', err.code, err.detail || err.message);
    return problem(res, 409, 'The change conflicts with existing data (duplicate or invalid reference).', path);
  }

  console.error('Unhandled exception', err);
  const detail = process.env.VERCEL_ENV === 'production' ? 'An unexpected error occurred.' : String(err?.message || err);
  return problem(res, 500, detail, path);
}

export async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  const buf = Buffer.concat(chunks);
  if (buf.length > 0) return buf;

  // Fallback for runtimes that already consumed the stream into req.body.
  if (Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string') return Buffer.from(req.body);
  if (req.body && typeof req.body === 'object') return Buffer.from(JSON.stringify(req.body));
  return buf;
}

export function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd) return fwd.split(',')[0].trim();
  return req.headers['x-real-ip'] || req.socket?.remoteAddress || 'unknown';
}

// Best-effort limiter (10 attempts per minute per IP). Serverless instances don't share
// memory, so this throttles bursts rather than guaranteeing a global limit.
const windows = new Map();
export function rateLimited(req, limit = 10, windowMs = 60_000) {
  const key = clientIp(req);
  const now = Date.now();
  const w = windows.get(key);
  if (!w || now - w.start >= windowMs) {
    windows.set(key, { start: now, count: 1 });
    if (windows.size > 5000) {
      for (const [k, v] of windows) if (now - v.start >= windowMs) windows.delete(k);
    }
    return false;
  }
  w.count += 1;
  return w.count > limit;
}

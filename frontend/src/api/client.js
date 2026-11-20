const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:5080').replace(/\/+$/, '');
const TOKEN_KEY = 'pb_token';

export class ApiError extends Error {
  constructor(message, status, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export const tokenStore = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (t) => localStorage.setItem(TOKEN_KEY, t),
  clear: () => localStorage.removeItem(TOKEN_KEY),
};

/** Turns API-relative paths (e.g. player photos) into absolute URLs. */
export function assetUrl(path) {
  if (!path) return null;
  return /^https?:\/\//.test(path) ? path : `${API_URL}${path}`;
}

function buildQuery(params) {
  if (!params) return '';
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') qs.append(k, v);
  });
  const s = qs.toString();
  return s ? `?${s}` : '';
}

async function parseError(res) {
  let body = null;
  try {
    body = await res.json();
  } catch {
    /* non-JSON error */
  }

  let message = body?.detail || body?.title || res.statusText || 'Request failed';
  if (body?.errors) {
    // ASP.NET validation problem details: { errors: { Field: ["msg"] } }
    const msgs = Object.values(body.errors).flat();
    if (msgs.length) message = msgs.join(' ');
  }
  if (res.status === 429) message = 'Too many attempts. Please wait a minute and try again.';
  return new ApiError(message, res.status, body);
}

async function request(method, path, { params, body, form } = {}) {
  const headers = {};
  const token = tokenStore.get();
  if (token) headers.Authorization = `Bearer ${token}`;

  let payload;
  if (form) payload = form;
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }

  let res;
  try {
    res = await fetch(`${API_URL}${path}${buildQuery(params)}`, { method, headers, body: payload });
  } catch {
    throw new ApiError('Cannot reach the server. Check your connection or try again shortly.', 0);
  }

  if (res.status === 401 && token) {
    window.dispatchEvent(new Event('auth:expired'));
  }
  if (!res.ok) throw await parseError(res);
  if (res.status === 204) return null;

  const type = res.headers.get('content-type') || '';
  return type.includes('application/json') ? res.json() : res.text();
}

export const http = {
  get: (path, params) => request('GET', path, { params }),
  post: (path, body) => request('POST', path, { body }),
  put: (path, body) => request('PUT', path, { body }),
  patch: (path, body) => request('PATCH', path, { body }),
  del: (path) => request('DELETE', path),
  upload: (path, form) => request('POST', path, { form }),
};

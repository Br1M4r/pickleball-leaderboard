import { http } from './client';

export const authApi = {
  login: (email, password) => http.post('/api/auth/login', { email, password }),
  register: (data) => http.post('/api/auth/register', data),
  me: () => http.get('/api/auth/me'),
  changePassword: (currentPassword, newPassword) =>
    http.post('/api/auth/change-password', { currentPassword, newPassword }),
};

export const leaderboardApi = {
  get: (params) => http.get('/api/leaderboard', params),
  recalculate: () => http.post('/api/leaderboard/recalculate'),
};

export const playersApi = {
  list: (params) => http.get('/api/players', params),
  get: (id) => http.get(`/api/players/${id}`),
  matches: (id, params) => http.get(`/api/players/${id}/matches`, params),
  create: (data) => http.post('/api/players', data),
  update: (id, data) => http.put(`/api/players/${id}`, data),
  updateMe: (data) => http.put('/api/players/me', data),
  setStatus: (id, isActive) => http.patch(`/api/players/${id}/status`, { isActive }),
  uploadPhoto: (id, file) => {
    const form = new FormData();
    form.append('file', file);
    return http.upload(`/api/players/${id}/photo`, form);
  },
  deletePhoto: (id) => http.del(`/api/players/${id}/photo`),

  /** Loads every player page (used by pickers). */
  async all(params = {}) {
    const items = [];
    let page = 1;
    for (;;) {
      const res = await http.get('/api/players', { ...params, page, pageSize: 100 });
      items.push(...res.items);
      if (page >= res.totalPages || res.items.length === 0) break;
      page += 1;
    }
    return items;
  },
};

export const matchesApi = {
  list: (params) => http.get('/api/matches', params),
  get: (id) => http.get(`/api/matches/${id}`),
  history: (id) => http.get(`/api/matches/${id}/history`),
  create: (data) => http.post('/api/matches', data),
  update: (id, data) => http.put(`/api/matches/${id}`, data),
  recordResult: (id, data) => http.put(`/api/matches/${id}/result`, data),
  cancel: (id, reason) => http.post(`/api/matches/${id}/cancel`, { reason }),
  restore: (id, reason) => http.post(`/api/matches/${id}/restore`, { reason }),
};

export const usersApi = {
  list: (params) => http.get('/api/users', params),
  create: (data) => http.post('/api/users', data),
  update: (id, data) => http.put(`/api/users/${id}`, data),
  resetPassword: (id, newPassword) => http.post(`/api/users/${id}/reset-password`, { newPassword }),
};

export const rulesApi = {
  get: () => http.get('/api/ranking-rules'),
  update: (data) => http.put('/api/ranking-rules', data),
};

export const dashboardApi = {
  get: () => http.get('/api/dashboard'),
};

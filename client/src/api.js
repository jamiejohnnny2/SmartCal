const BASE = '/api';

async function request(path, options) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

export const api = {
  getAccounts: () => request('/accounts'),
  getAuthUrl: (label) => request(`/accounts/auth-url?label=${encodeURIComponent(label)}`),
  deleteAccount: (id) => request(`/accounts/${id}`, { method: 'DELETE' }),

  getCalendars: () => request('/calendars'),

  getEvents: () => request('/events'),
  createEvent: (event) => request('/events', { method: 'POST', body: JSON.stringify(event) }),
  updateEvent: (id, patch) => request(`/events/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteEvent: (id) => request(`/events/${id}`, { method: 'DELETE' }),

  triggerSync: () => request('/sync', { method: 'POST' }),

  getFocus: () => request('/focus'),
};

let accessToken;
let refreshPromise;
const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('workify-auth') : null;
function forgetSession(message) {
  accessToken = undefined;
  window.dispatchEvent(new CustomEvent('workify:session-ended', { detail: message }));
}
if (channel) channel.onmessage = event => { if (event.data === 'logout') forgetSession(); };

export class ApiError extends Error {
  constructor(status, data) {
    super(data?.error?.message ?? data?.message ?? 'Сервис временно недоступен. Повторите позже');
    this.status = status;
    this.code = data?.error?.code;
    this.details = data?.error?.details ?? [];
  }
}
async function send(path, { method = 'GET', body } = {}) {
  let response;
  try {
    response = await fetch(`/api${path}`, { method, credentials: 'same-origin', signal: AbortSignal.timeout(10000),
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(method !== 'GET' ? { 'X-Workify-Client': 'browser' } : {}),
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}) });
  } catch { throw new ApiError(0); }
  const data = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(response.status, data);
  return data;
}
const sessionLock = operation => navigator.locks ? navigator.locks.request('workify-session', operation) : operation();
export function restoreSession() {
  if (!refreshPromise) {
    refreshPromise = sessionLock(async () => {
      const result = await send('/auth/refresh', { method: 'POST' });
      accessToken = result.accessToken;
      return result.user;
    }).finally(() => { refreshPromise = undefined; });
  }
  return refreshPromise;
}
export async function authenticate(mode, body) {
  return sessionLock(async () => {
    const result = await send(`/auth/${mode}`, { method: 'POST', body });
    accessToken = result.accessToken;
    return result.user;
  });
}
export async function logout() {
  await sessionLock(() => send('/auth/logout', { method: 'POST' }));
  forgetSession();
  channel?.postMessage('logout');
}
export async function api(path, options) {
  try { return await send(path, options); }
  catch (error) {
    if (error.status === 401) {
      try { await restoreSession(); return await send(path, options); }
      catch (refreshError) {
        if ([401, 403].includes(refreshError.status)) forgetSession(refreshError.message);
        throw refreshError;
      }
    }
    if (error.code === 'ACCOUNT_BLOCKED') forgetSession(error.message);
    throw error;
  }
}

const cookieName = 'workify_refresh';
export function refreshCookie(request) {
  const values = (request.headers.cookie ?? '').split(';').map(value => value.trim()).filter(value => value.startsWith(`${cookieName}=`));
  return values.length === 1 ? values[0].slice(cookieName.length + 1) : undefined;
}

export function createAuthController(service, { cookieSecure }) {
  const options = { httpOnly: true, secure: cookieSecure, sameSite: 'strict', path: '/api/auth' };
  function respond(response, result, status = 200) {
    response.cookie(cookieName, result.refreshToken, { ...options, expires: new Date(result.expiresAt) });
    response.set('Cache-Control', 'no-store').status(status).json({ user: result.user, accessToken: result.accessToken });
  }
  return {
    register: async (request, response) => respond(response, await service.register(request.validated.body), 201),
    login: async (request, response) => respond(response, await service.login(request.validated.body)),
    refresh: async (request, response) => {
      try { respond(response, await service.refresh(refreshCookie(request))); }
      catch (error) {
        if ([401, 403].includes(error.statusCode)) response.clearCookie(cookieName, options);
        throw error;
      }
    },
    logout: async (request, response) => {
      await service.logout(refreshCookie(request));
      response.clearCookie(cookieName, options).set('Cache-Control', 'no-store').status(204).end();
    },
    me: (request, response) => response.set('Cache-Control', 'no-store').json({ user: request.user }),
    adminAccess: (request, response) => response.set('Cache-Control', 'no-store').json({ user: request.user, access: 'ADMIN' }),
  };
}

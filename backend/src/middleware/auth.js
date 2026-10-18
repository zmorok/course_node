import { AppError } from '../utils/app-error.js';
import { asyncHandler } from '../utils/async-handler.js';

export const authMiddleware = service => asyncHandler(async (request, response, next) => {
  const authorization = request.get('authorization') ?? '';
  if (!/^Bearer [A-Za-z0-9._-]+$/.test(authorization) || authorization.length > 4096) {
    response.set('WWW-Authenticate', 'Bearer');
    throw new AppError(401, 'UNAUTHENTICATED', 'Войдите в аккаунт');
  }
  try { request.user = await service.authenticate(authorization.slice(7)); }
  catch (error) { if (error.statusCode === 401) response.set('WWW-Authenticate', 'Bearer'); throw error; }
  next();
});

export const roleMiddleware = (...roles) => (request, _response, next) => {
  if (!request.user) return next(new AppError(401, 'UNAUTHENTICATED', 'Войдите в аккаунт'));
  if (!roles.includes(request.user.role)) return next(new AppError(403, 'FORBIDDEN', 'Доступ запрещён'));
  next();
};

// A custom header requires a CORS preflight; cross-origin access is not enabled.
export function authCsrf(request, _response, next) {
  if (request.get('X-Workify-Client') !== 'browser' || request.get('Sec-Fetch-Site') === 'cross-site') {
    return next(new AppError(403, 'CSRF_REJECTED', 'Запрос отклонён. Обновите страницу'));
  }
  next();
}

import { AppError } from '../utils/app-error.js';

const databaseUnavailable = new Set(['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EHOSTUNREACH', '57P01', '57P02', '57P03', '53300']);

function publicError(error) {
  if (error instanceof AppError) {
    if (error.statusCode >= 400 && error.statusCode < 500) return error;
    return new AppError(error.statusCode === 503 ? 503 : 500,
      error.statusCode === 503 ? 'SERVICE_UNAVAILABLE' : 'INTERNAL_ERROR',
      error.statusCode === 503 ? 'Сервис временно недоступен' : 'Внутренняя ошибка сервера');
  }
  if (error?.type === 'entity.parse.failed') return new AppError(400, 'INVALID_JSON', 'Некорректный JSON');
  if (error?.type === 'entity.too.large') return new AppError(413, 'PAYLOAD_TOO_LARGE', 'Превышен размер запроса');
  if (['charset.unsupported', 'encoding.unsupported'].includes(error?.type)) return new AppError(415, 'UNSUPPORTED_ENCODING', 'Неподдерживаемая кодировка запроса');
  if (['request.aborted', 'request.size.invalid'].includes(error?.type) || error instanceof URIError) return new AppError(400, 'INVALID_REQUEST', 'Некорректный запрос');
  if (['23505', '23503', '23P01', '40001', '40P01'].includes(error?.code)) return new AppError(409, 'CONFLICT', 'Конфликт данных');
  if (['23502', '23514', '22P02', '22003'].includes(error?.code)) return new AppError(422, 'VALIDATION_ERROR', 'Некорректные данные запроса');
  if (databaseUnavailable.has(error?.code) || (typeof error?.code === 'string' && /^08[A-Z0-9]{3}$/.test(error.code))) return new AppError(503, 'SERVICE_UNAVAILABLE', 'Сервис временно недоступен');
  return new AppError(500, 'INTERNAL_ERROR', 'Внутренняя ошибка сервера');
}

export function createErrorHandler(logger = console) {
  return function errorHandler(error, request, response, next) {
    if (response.headersSent) return next(error);
    const problem = publicError(error);
    if (problem.statusCode >= 500) {
      logger.error(JSON.stringify({ event: 'request_failed', requestId: request.requestId, code: problem.code, status: problem.statusCode }));
    }
    response.set('Cache-Control', 'no-store').status(problem.statusCode).json({
      error: { code: problem.code, message: problem.message, details: problem.details },
      requestId: request.requestId,
    });
  };
}

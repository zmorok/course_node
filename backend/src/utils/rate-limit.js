import { rateLimit } from 'express-rate-limit';

import { AppError } from './app-error.js';

export function createRateLimit(minutes, limit) {
  return rateLimit({
    windowMs: minutes * 60 * 1000,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_request, _response, next) =>
      next(new AppError(429, 'RATE_LIMITED', 'Слишком много запросов. Повторите позже')),
  });
}

import { AppError } from '../utils/app-error.js';

export function notFound(_request, _response, next) {
  next(new AppError(404, 'NOT_FOUND', 'Ресурс не найден'));
}

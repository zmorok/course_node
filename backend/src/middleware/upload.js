import multer from 'multer';
import { MAX_FILE_BYTES, validateFileHeader } from '../services/file-policy.js';
import { AppError } from '../utils/app-error.js';

// Bounded memory: at most four 10 MiB file buffers per API process.
export function createUploadMiddleware() {
  let active = 0;
  const receive = multer({ storage: multer.memoryStorage(), preservePath: true, defParamCharset: 'utf8',
    limits: { fileSize: MAX_FILE_BYTES, files: 1, fields: 0, parts: 1, fieldNameSize: 50, headerPairs: 50 },
    fileFilter: (_request, file, done) => { try { validateFileHeader(file); done(null, true); } catch (error) { done(error); } },
  }).single('file');
  return (request, response, next) => {
    if (!request.is('multipart/form-data')) return next(new AppError(415, 'MULTIPART_REQUIRED', 'Ожидается multipart/form-data с полем file'));
    if (active >= 4) return next(new AppError(429, 'UPLOAD_BUSY', 'Загрузка занята. Повторите позже'));
    active++;
    let released = false;
    const release = () => { if (!released) { active--; released = true; } };
    response.once('finish', release); response.once('close', release);
    receive(request, response, error => {
      if (error instanceof multer.MulterError) return next(new AppError(error.code === 'LIMIT_FILE_SIZE' ? 413 : 422,
        error.code === 'LIMIT_FILE_SIZE' ? 'FILE_TOO_LARGE' : 'INVALID_UPLOAD',
        error.code === 'LIMIT_FILE_SIZE' ? 'Максимальный размер файла — 10 МБ' : 'Отправьте один файл в поле file без дополнительных полей'));
      if (error && !(error instanceof AppError)) return next(new AppError(400, 'INVALID_MULTIPART', 'Некорректная форма загрузки'));
      next(error);
    });
  };
}

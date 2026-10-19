import { extname } from 'node:path';
import { createHash } from 'node:crypto';
import { fileTypeFromBuffer } from 'file-type';
import { AppError } from '../utils/app-error.js';

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const fileTypes = Object.freeze({
  '.png': ['image/png'], '.jpg': ['image/jpeg'], '.jpeg': ['image/jpeg'], '.webp': ['image/webp'],
  '.pdf': ['application/pdf'], '.txt': ['text/plain'], '.zip': ['application/zip', 'application/x-zip-compressed'],
  '.docx': ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'], '.mp4': ['video/mp4'],
});
const unsupported = () => new AppError(415, 'UNSUPPORTED_FILE_TYPE', 'Поддерживаются PNG, JPEG, WebP, PDF, TXT, DOCX, ZIP и MP4');
export function validateFileHeader(file) {
  const name = file.originalname;
  if (typeof name !== 'string' || !name.trim() || name.length > 255 || /[/\\\u0000-\u001f\u007f]/.test(name) || name.includes('..')) {
    throw new AppError(422, 'INVALID_FILE_NAME', 'Недопустимое имя файла');
  }
  if (!fileTypes[extname(name).toLowerCase()]?.includes(file.mimetype)) throw unsupported();
}
export async function inspectFile(file) {
  if (!file?.buffer?.length) throw new AppError(422, 'EMPTY_FILE', 'Выберите непустой файл');
  if (file.buffer.length > MAX_FILE_BYTES) throw new AppError(413, 'FILE_TOO_LARGE', 'Максимальный размер файла — 10 МБ');
  validateFileHeader(file);
  const extension = extname(file.originalname).toLowerCase();
  let detected;
  try { detected = await fileTypeFromBuffer(file.buffer); } catch { throw unsupported(); }
  if (extension === '.txt') {
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(file.buffer);
      if (detected || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) throw unsupported();
    } catch { throw unsupported(); }
  } else if (!detected || !fileTypes[extension].includes(detected.mime)) throw unsupported();
  return { originalName: file.originalname, mimeType: detected?.mime ?? 'text/plain', sizeBytes: file.buffer.length,
    extension: extension === '.jpeg' ? '.jpg' : extension, sha256: createHash('sha256').update(file.buffer).digest('hex') };
}

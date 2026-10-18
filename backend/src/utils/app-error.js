export class AppError extends Error {
  constructor(statusCode, code, message, { details = [], cause } = {}) {
    super(message, { cause });
    if (!Number.isInteger(statusCode) || statusCode < 400 || statusCode > 599
        || !/^[A-Z][A-Z0-9_]*$/.test(code) || typeof message !== 'string' || !Array.isArray(details)) {
      throw new TypeError('Invalid application error definition');
    }
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export class ValidationError extends AppError {
  constructor(details) {
    super(422, 'VALIDATION_ERROR', 'Некорректные данные запроса', { details });
    this.name = 'ValidationError';
  }
}

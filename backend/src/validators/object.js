import { ValidationError } from '../utils/app-error.js';

const forbiddenKeys = new Set(['__proto__', 'prototype', 'constructor']);

export function object(shape, { field = 'body' } = {}) {
  return input => {
    if (input === null || typeof input !== 'object' || Array.isArray(input)
        || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) {
      throw new ValidationError([{ field, message: 'Ожидается объект' }]);
    }
    const issues = [];
    for (const key of Object.keys(input)) {
      if (forbiddenKeys.has(key) || !Object.hasOwn(shape, key)) issues.push({ field: `${field}.${key}`, message: 'Поле не поддерживается' });
    }
    const result = Object.create(null);
    for (const [key, rule] of Object.entries(shape)) {
      if (forbiddenKeys.has(key)) throw new TypeError('Reserved validation field');
      const value = rule(Object.hasOwn(input, key) ? input[key] : undefined, `${field}.${key}`, issues);
      if (value !== undefined) result[key] = value;
    }
    if (issues.length) throw new ValidationError(issues);
    return result;
  };
}

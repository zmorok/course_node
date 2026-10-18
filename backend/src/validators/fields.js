function invalid(issues, field, message) {
  issues.push({ field, message });
  return undefined;
}

export function text({ min = 1, max = 1000, trim = true, pattern } = {}) {
  return (input, field, issues) => {
    if (typeof input !== 'string') return invalid(issues, field, 'Ожидается строка');
    const value = trim ? input.trim() : input;
    if (value.length < min || value.length > max) return invalid(issues, field, `Длина должна быть от ${min} до ${max}`);
    if (pattern && !new RegExp(pattern.source, pattern.flags.replace(/[gy]/g, '')).test(value)) return invalid(issues, field, 'Некорректный формат');
    return value;
  };
}

export function integer({ min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER, coerce = false } = {}) {
  return (input, field, issues) => {
    const value = coerce && typeof input === 'string' && /^-?\d+$/.test(input) ? Number(input) : input;
    if (!Number.isSafeInteger(value) || value < min || value > max) return invalid(issues, field, `Ожидается целое число от ${min} до ${max}`);
    return value;
  };
}

export function uuid() {
  return (input, field, issues) => {
    if (typeof input !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input)) return invalid(issues, field, 'Ожидается UUID');
    return input.toLowerCase();
  };
}

export function oneOf(values) {
  return (input, field, issues) => values.includes(input) ? input : invalid(issues, field, 'Недопустимое значение');
}

export function optional(rule, defaultValue) {
  return (input, field, issues) => {
    if (input === undefined && defaultValue === undefined) return undefined;
    return rule(input === undefined ? defaultValue : input, field, issues);
  };
}

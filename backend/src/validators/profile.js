import { object } from './object.js';
import { optional, text, uuid, oneOf } from './fields.js';
import { emailField, usernameField } from './auth.js';
import { ValidationError } from '../utils/app-error.js';

function safeText(options, multiline = false) {
  const parse = text(options);
  return (input, field, issues) => {
    const value = parse(input, field, issues);
    const controls = multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/ : /[\u0000-\u001f\u007f]/;
    if (value !== undefined && controls.test(value)) issues.push({ field, message: 'Недопустимые управляющие символы' });
    return value;
  };
}
function nullableText(max, pattern) {
  const parse = safeText({ min: 0, max });
  return (input, field, issues) => {
    if (input === null) return null;
    const value = parse(input, field, issues);
    if (value && pattern && !pattern.test(value)) issues.push({ field, message: 'Некорректный формат' });
    return value === '' ? null : value;
  };
}
export const profileFields = {
  middleName: optional(nullableText(100)), gender: optional((value, field, issues) => value === null || value === '' ? null : oneOf(['Male','Female','Other'])(value, field, issues)),
  firstName: optional(safeText({ max: 100 })), lastName: optional(safeText({ max: 100 })),
  headline: optional(safeText({ min: 0, max: 200 })),
  description: optional(safeText({ min: 0, max: 5000 }, true)),
  phone: optional(nullableText(30, /^\+?[0-9 ().-]{5,30}$/)),
  city: optional(nullableText(100)), country: optional(nullableText(100)),
  email: optional(emailField()), username: optional(usernameField()),
  currentPassword: optional(text({ min: 1, max: 128, trim: false })),
};
const parsePatch = object(profileFields);
export function profilePatch(input) {
  const value = parsePatch(input);
  if (!Object.keys(value).some(key => key !== 'currentPassword')) {
    throw new ValidationError([{ field: 'body', message: 'Укажите хотя бы одно поле профиля' }]);
  }
  if (value.email && /[\u0000-\u001f\u007f]/.test(value.email)) throw new ValidationError([{ field: 'body.email', message: 'Некорректный email' }]);
  return value;
}
export const profileParams = object({ userId: uuid() }, { field: 'params' });
export const userSkillsInput = object({
  skillIds(input, field, issues) {
    if (!Array.isArray(input) || input.length > 50) {
      issues.push({ field, message: 'Ожидается список не более 50 навыков' });
      return undefined;
    }
    const ids = input.map((value, index) => uuid()(value, `${field}.${index}`, issues));
    if (new Set(ids).size !== ids.length) issues.push({ field, message: 'Навыки не должны повторяться' });
    return ids;
  },
});

export const passwordChange = object({currentPassword: text({min:1,max:128,trim:false}),newPassword: text({min:12,max:128,trim:false})});

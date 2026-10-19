import { object } from './object.js';
import { text, uuid, optional, integer, oneOf } from './fields.js';
import { ValidationError } from '../utils/app-error.js';

export const projectStatuses = ['DRAFT', 'OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'];
export function money({ zero = false, coerce = false } = {}) {
  return (input, field, issues) => {
    const value = (typeof input === 'number' || coerce && typeof input === 'string') ? String(input) : input;
    if (typeof value !== 'string' || !/^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/.test(value) || (!zero && Number(value) === 0)) {
      issues.push({ field, message: 'Нужно положительное число до 9999999999.99, не более двух знаков после точки' }); return;
    }
    const [whole, fraction = ''] = value.split('.');
    return `${whole}.${fraction.padEnd(2, '0')}`;
  };
}
function safeText(max, min = 1, multiline = false) {
  const parse = text({ min, max });
  return (input, field, issues) => {
    const value = parse(input, field, issues);
    if (value && (multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/ : /[\u0000-\u001f\u007f]/).test(value)) issues.push({ field, message: 'Недопустимые управляющие символы' });
    return value;
  };
}
const nullable = rule => (input, field, issues) => input === null ? null : rule(input, field, issues);
function deadline(input, field, issues) {
  if (typeof input !== 'string' || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(input) || !Number.isFinite(Date.parse(input))
      || new Date(`${input.slice(0,10)}T00:00:00Z`).toISOString().slice(0,10)!==input.slice(0,10)) {
    issues.push({ field, message: 'Нужна дата ISO 8601 с часовым поясом' }); return;
  }
  return new Date(input).toISOString();
}
function ids(max) {
  return (input, field, issues) => {
    if (!Array.isArray(input) || input.length > max) { issues.push({ field, message: `Нужно не более ${max} идентификаторов` }); return; }
    const result = input.map((id, index) => uuid()(id, `${field}.${index}`, issues));
    if (new Set(result).size !== result.length) issues.push({ field, message: 'Идентификаторы не должны повторяться' });
    return result;
  };
}
const fields = { title: safeText(200), description: safeText(10000, 0, true), categoryId: nullable(uuid()),
  budget: nullable(money()), desiredDeadlineAt: nullable(deadline), skillIds: ids(20), fileIds: ids(8) };
export const projectCreate = object({ title: fields.title, description: optional(fields.description, ''), categoryId: optional(fields.categoryId, null),
  budget: optional(fields.budget, null), desiredDeadlineAt: optional(fields.desiredDeadlineAt, null), skillIds: optional(fields.skillIds, []), fileIds: optional(fields.fileIds, []) });
const parsePatch = object(Object.fromEntries(Object.entries(fields).map(([key, rule]) => [key, optional(rule)])));
export function projectPatch(input) {
  const result = parsePatch(input);
  if (!Object.keys(result).length) throw new ValidationError([{ field: 'body', message: 'Укажите изменения проекта' }]);
  return result;
}
export const projectParams = object({ projectId: uuid() }, { field: 'params' });
export const projectFileParams = object({ projectId: uuid(), fileId: uuid() }, { field: 'params' });
export const projectFileInput = object({ fileId: uuid() });
export const projectCancel = object({ reason: safeText(1000) });
const parseEmpty = object({});
export const emptyCommand = input => parseEmpty(input === undefined ? {} : input);
const listFields = { search: optional(safeText(100, 0), ''), category: optional(text({ max: 80, pattern: /^[a-z0-9]+(?:-[a-z0-9]+)*$/ })),
  skill: optional(text({ max: 80, pattern: /^[a-z0-9]+(?:-[a-z0-9]+)*$/ })), minBudget: optional(money({ zero: true, coerce: true })), maxBudget: optional(money({ zero: true, coerce: true })),
  sort: optional(oneOf(['newest', 'oldest', 'budget_asc', 'budget_desc', 'deadline_asc']), 'newest'),
  page: optional(integer({ min: 1, max: 10000, coerce: true }), 1), pageSize: optional(integer({ min: 1, max: 24, coerce: true }), 12) };
function listParser(shape) {
  const parse = object(shape, { field: 'query' });
  return input => {
    const result = parse(input);
    if (result.minBudget !== undefined && result.maxBudget !== undefined && Number(result.minBudget) > Number(result.maxBudget)) throw new ValidationError([{ field: 'query.maxBudget', message: 'Верхняя граница меньше нижней' }]);
    return result;
  };
}
export const projectQuery = listParser(listFields);
export const ownProjectQuery = listParser({ ...listFields, status: optional(oneOf(projectStatuses)) });

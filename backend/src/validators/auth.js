import { object } from './object.js';
import { text } from './fields.js';

const email = () => text({ max: 254, pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/ });
export const accountEmailInput = object({ email: email() });
export const registerInput = object({
  email: email(), username: text({ min: 3, max: 40, pattern: /^[A-Za-z0-9_]+$/ }),
  password: text({ min: 12, max: 128, trim: false }),
  firstName: text({ max: 100 }), lastName: text({ max: 100 }),
});
export const loginInput = object({ email: email(), password: text({ min: 1, max: 128, trim: false }) });

import { object } from './object.js';
import { text } from './fields.js';

export const emailField = () => text({ max: 254, pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/ });
export const usernameField = () => text({ min: 3, max: 40, pattern: /^[A-Za-z0-9_]+$/ });
export const accountEmailInput = object({ email: emailField() });
export const registerInput = object({
  email: emailField(), username: usernameField(),
  password: text({ min: 12, max: 128, trim: false }),
  firstName: text({ max: 100 }), lastName: text({ max: 100 }),
});
export const loginInput = object({ email: emailField(), password: text({ min: 1, max: 128, trim: false }) });

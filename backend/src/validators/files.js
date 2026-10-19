import { object } from './object.js';
import { uuid } from './fields.js';
export const fileParams = object({ fileId: uuid() }, { field: 'params' });
export const avatarInput = object({ fileId: uuid() });

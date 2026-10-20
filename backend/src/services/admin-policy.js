import {AppError} from '../utils/app-error.js';
export function requireAdmin(actor){if(!actor)throw new AppError(401,'UNAUTHENTICATED','Войдите в аккаунт');if(actor.status==='BLOCKED'&&(!actor.blocked_until||new Date(actor.blocked_until)>new Date()))throw new AppError(403,'ACCOUNT_BLOCKED','Аккаунт заблокирован');if(actor.role!=='ADMIN')throw new AppError(403,'FORBIDDEN','Доступ запрещён');}

import {createHash} from 'node:crypto';
import {AppError} from '../utils/app-error.js';
import {auditData} from '../utils/audit-data.js';
function stable(value){if(Array.isArray(value))return value.map(stable);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])]));return value;}
export function parseAuditArchive(buffer){
 let payload;try{payload=JSON.parse(buffer.toString('utf8'));}catch{throw new AppError(422,'INVALID_AUDIT_ARCHIVE','Файл должен содержать корректный JSON');}
 const entries=Array.isArray(payload)?payload:payload?.format==='workify-audit'&&payload.version===1?payload.entries:null;
 if(!Array.isArray(entries)||entries.length<1||entries.length>5000)throw new AppError(422,'INVALID_AUDIT_ARCHIVE','Нужен архив Workify или WPF из 1–5000 событий');
 return entries.map(row=>{
  if(!row||typeof row!=='object'||Array.isArray(row)||typeof row.action!=='string'||!row.action.trim()||row.action.length>100||!Number.isFinite(Date.parse(row.createdAt??row.changed_at)))throw new AppError(422,'INVALID_AUDIT_ARCHIVE','У события должны быть действие и корректная дата');
  const data=stable(auditData(row));return {data,digest:createHash('sha256').update(JSON.stringify(data)).digest('hex')};
 });
}

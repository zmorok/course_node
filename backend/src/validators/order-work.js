import {object} from './object.js';
import {optional,uuid,integer} from './fields.js';
import {content} from './proposals.js';
import {deadline} from './projects.js';
import {ValidationError} from '../utils/app-error.js';
const links=(input,field,issues)=>{
  if(!Array.isArray(input)||input.length>5){issues.push({field,message:'Укажите не более 5 ссылок'});return;}
  return input.map((item,index)=>{const key=`${field}.${index}`,value=content(2048)(item,key,issues);try{const url=new URL(value);if(!['http:','https:'].includes(url.protocol)||url.username||url.password||/[\u0000-\u0020\u007f]/.test(value))throw new Error();}catch{issues.push({field:key,message:'Нужна полная ссылка http:// или https:// без логина и пароля'});}return value;});
};
const fileIds=(input,field,issues)=>{if(!Array.isArray(input)||input.length>8){issues.push({field,message:'Можно прикрепить не более 8 файлов'});return;}const ids=input.map((id,index)=>uuid()(id,`${field}.${index}`,issues));if(new Set(ids).size!==ids.length)issues.push({field,message:'Файлы не должны повторяться'});return ids;};
const submission=object({comment:content(5000),links:optional(links,[]),fileIds:optional(fileIds,[])});
export function submissionCreate(input){const value=submission(input);if(!value.links.length&&!value.fileIds.length)throw new ValidationError([{field:'body.fileIds',message:'Добавьте хотя бы один файл или ссылку на результат'}]);return value;}
export const submissionRevision=object({comment:content(5000)});
const nullable=rule=>(input,field,issues)=>input===null?null:rule(input,field,issues);
const acceptance=object({comment:optional(nullable(content(5000)),null)});
export const submissionAccept=input=>acceptance(input===undefined?{}:input);
export const deadlineCreate=object({proposedDeadlineAt:deadline,reason:content(1000)});
export const deadlineReject=object({reason:content(1000)});
export const orderCancel=object({reason:content(1000)});
const approval=object({reason:optional(nullable(content(1000)),null)});
export const deadlineApprove=input=>approval(input===undefined?{}:input);
export const submissionParams=object({orderId:uuid(),submissionId:uuid()},{field:'params'});
export const deadlineParams=object({orderId:uuid(),requestId:uuid()},{field:'params'});
export const workQuery=object({page:optional(integer({min:1,max:10000,coerce:true}),1),pageSize:optional(integer({min:1,max:24,coerce:true}),12)},{field:'query'});

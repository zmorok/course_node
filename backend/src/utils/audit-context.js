import {AsyncLocalStorage} from 'node:async_hooks';
const context=new AsyncLocalStorage();
export const auditContext=(request,_response,next)=>context.run({ip:request.ip,requestId:request.requestId},next);
export const currentAuditContext=()=>context.getStore()??{};

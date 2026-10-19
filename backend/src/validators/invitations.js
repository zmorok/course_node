import {object} from './object.js';
import {uuid,optional,oneOf,integer} from './fields.js';
import {money,deadline} from './projects.js';
import {content} from './proposals.js';
export const invitationCreate=object({freelancerId:uuid(),message:content(5000),offeredPrice:optional((value,field,issues)=>value===null?null:money()(value,field,issues),null),
  offeredDeadlineAt:deadline,expiresAt:optional((value,field,issues)=>value===null?null:deadline(value,field,issues),null)});
const decline=object({reason:optional(content(1000),'RECIPIENT_DECLINED')});
export const invitationDecline=input=>decline(input===undefined?{}:input);
export const invitationParams=object({invitationId:uuid()},{field:'params'});
const fields={status:optional(oneOf(['PENDING','ACCEPTED','DECLINED','EXPIRED'])),page:optional(integer({min:1,max:10000,coerce:true}),1),pageSize:optional(integer({min:1,max:24,coerce:true}),12)};
export const projectInvitationQuery=object(fields,{field:'query'});
export const ownInvitationQuery=object({...fields,box:optional(oneOf(['incoming','sent']),'incoming'),projectId:optional(uuid())},{field:'query'});

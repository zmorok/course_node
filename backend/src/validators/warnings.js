import {object} from './object.js';
import {optional,oneOf,integer} from './fields.js';
import {content} from './proposals.js';
import {deadline} from './projects.js';
export const warningInput=object({message:content(5000),expiresAt:optional((input,field,issues)=>input===null?null:deadline(input,field,issues),null)});
export const warningQuery=object({type:optional(oneOf(['WARNING','TEMPORARY_BLOCK','PERMANENT_BLOCK'])),page:optional(integer({min:1,max:10000,coerce:true}),1),pageSize:optional(integer({min:1,max:24,coerce:true}),12)},{field:'query'});

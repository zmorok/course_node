import {object} from './object.js';
import {optional,oneOf,integer,uuid} from './fields.js';
export const notificationQuery=object({read:optional(oneOf(['all','unread','read']),'all'),page:optional(integer({min:1,max:10000,coerce:true}),1),pageSize:optional(integer({min:1,max:24,coerce:true}),12)},{field:'query'});
export const notificationParams=object({notificationId:uuid()},{field:'params'});
export const notificationEmpty=object({});
export const notificationEmptyQuery=object({},{field:'query'});

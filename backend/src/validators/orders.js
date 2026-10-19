import {object} from './object.js';
import {optional,oneOf,integer,uuid} from './fields.js';
import {ValidationError} from '../utils/app-error.js';
export const activeOrderStatuses=['IN_PROGRESS','SUBMITTED','REVISION_REQUESTED'];
export const historyOrderStatuses=['COMPLETED','CANCELLED'];
const query=object({mode:optional(oneOf(['customer','freelancer']),'customer'),scope:optional(oneOf(['active','history']),'active'),
  status:optional(oneOf([...activeOrderStatuses,...historyOrderStatuses])),page:optional(integer({min:1,max:10000,coerce:true}),1),pageSize:optional(integer({min:1,max:24,coerce:true}),12)},{field:'query'});
export function orderQuery(input){const value=query(input);if(value.status&&!(value.scope==='active'?activeOrderStatuses:historyOrderStatuses).includes(value.status))throw new ValidationError([{field:'query.status',message:'Статус не относится к выбранному списку заказов'}]);return value;}
export const orderParams=object({orderId:uuid()},{field:'params'});
export const orderDetailQuery=object({},{field:'query'});

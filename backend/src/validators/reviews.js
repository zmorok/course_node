import {object} from './object.js';
import {integer,optional,oneOf,uuid} from './fields.js';
import {content} from './proposals.js';
export const reviewInput=object({rating:integer({min:1,max:5}),text:content(5000)});
export const reviewParams=object({reviewId:uuid()},{field:'params'});
const pagination={page:optional(integer({min:1,max:10000,coerce:true}),1),pageSize:optional(integer({min:1,max:24,coerce:true}),12)};
export const publicReviewQuery=object({mode:optional(oneOf(['customer','freelancer']),'freelancer'),...pagination},{field:'query'});
export const ownReviewQuery=object({mode:optional(oneOf(['customer','freelancer']),'customer'),direction:optional(oneOf(['received','written']),'received'),...pagination},{field:'query'});

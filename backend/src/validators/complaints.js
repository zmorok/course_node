import {object} from './object.js';
import {uuid,optional,oneOf,integer} from './fields.js';
import {content} from './proposals.js';
const fileIds=(input,field,issues)=>{if(!Array.isArray(input)||input.length>8){issues.push({field,message:'Можно прикрепить не более 8 файлов'});return;}const ids=input.map((id,index)=>uuid()(id,`${field}.${index}`,issues));if(new Set(ids).size!==ids.length)issues.push({field,message:'Файлы не должны повторяться'});return ids;};
export const complaintInput=object({reason:content(80),description:content(5000),fileIds:optional(fileIds,[])});
export const complaintParams=object({complaintId:uuid()},{field:'params'});
export const complaintQuery=object({mode:optional(oneOf(['customer','freelancer']),'customer'),direction:optional(oneOf(['submitted']),'submitted'),status:optional(oneOf(['NEW','IN_REVIEW','RESOLVED','REJECTED'])),page:optional(integer({min:1,max:10000,coerce:true}),1),pageSize:optional(integer({min:1,max:24,coerce:true}),12)},{field:'query'});

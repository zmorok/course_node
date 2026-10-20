import {object} from './object.js';
import {optional,oneOf,integer,uuid,text} from './fields.js';
import {content} from './proposals.js';
import {deadline} from './projects.js';
import {ValidationError} from '../utils/app-error.js';
const pages={page:optional(integer({min:1,max:10000,coerce:true}),1),pageSize:optional(integer({min:1,max:24,coerce:true}),12)};
const search=()=>optional(text({max:100,pattern:/^[^\u0000-\u001f\u007f]*$/}));
export const adminUserQuery=object({search:search(),role:optional(oneOf(['CLIENT','ADMIN'])),status:optional(oneOf(['ACTIVE','BLOCKED'])),sort:optional(oneOf(['newest','name']),'newest'),...pages},{field:'query'});
const queue=object({id:optional(uuid()),status:optional(oneOf(['NEW','IN_REVIEW','RESOLVED','REJECTED'])),reporter:search(),target:search(),orderId:optional(uuid()),projectId:optional(uuid()),categoryId:optional(uuid()),reason:search(),userId:optional(uuid()),assignedAdminId:optional(uuid()),assignment:optional(oneOf(['all','mine','unassigned']),'all'),createdFrom:optional(deadline),createdTo:optional(deadline),...pages},{field:'query'});
export function adminComplaintQuery(input){const query=queue(input);if(query.createdFrom&&query.createdTo&&query.createdFrom>query.createdTo)throw new ValidationError([{field:'query.createdTo',message:'Конец периода должен быть не раньше начала'}]);return query;}
const expiry=optional((input,field,issues)=>input===null?null:deadline(input,field,issues),null);
export const adminBlock=object({type:oneOf(['TEMPORARY_BLOCK','PERMANENT_BLOCK']),reason:content(5000),expiresAt:expiry});
export const adminUnblock=object({reason:content(5000)});
export const adminReject=object({resolutionNote:content(5000)});
const action=object({targetId:uuid(),type:oneOf(['WARNING','TEMPORARY_BLOCK','PERMANENT_BLOCK']),reason:content(5000),expiresAt:expiry});
export const adminResolve=object({resolutionNote:content(5000),actions:(input,field,issues)=>{if(!Array.isArray(input)||input.length<1||input.length>6){issues.push({field,message:'Укажите от 1 до 6 санкций'});return;}const result=input.map((value,index)=>{try{return action(value);}catch(error){if(!(error instanceof ValidationError))throw error;issues.push(...error.details.map(issue=>({...issue,field:`${field}.${index}.${issue.field.replace(/^body\./,'')}`})));}});const keys=result.filter(Boolean).map(value=>`${value.targetId}:${value.type}`);if(new Set(keys).size!==keys.length)issues.push({field,message:'Санкции одного типа для одного участника не должны повторяться'});return result;}});
export const adminContextParams=object({complaintId:uuid(),section:oneOf(['submissions','deadline-requests','events','reviews'])},{field:'params'});

import {profileFields} from './profile.js';
import {emailField,usernameField} from './auth.js';
const {currentPassword,...editableProfile}=profileFields;
export const adminAccountCreate=object({...editableProfile,email:emailField(),username:usernameField(),firstName:text({max:100}),lastName:text({max:100}),password:text({min:12,max:128,trim:false}),role:optional(oneOf(['CLIENT','ADMIN']),'CLIENT')});
const parseAccountPatch=object({...editableProfile,role:optional(oneOf(['CLIENT','ADMIN'])),newPassword:optional(text({min:12,max:128,trim:false}))});
export function adminAccountUpdate(input){const result=parseAccountPatch(input);if(!Object.keys(result).length)throw new ValidationError([{field:'body',message:'Укажите изменения пользователя'}]);return result;}
export const adminAccountDelete=object({reason:content(1000)});

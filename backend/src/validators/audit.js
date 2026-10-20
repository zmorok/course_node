import {object} from './object.js';
import {optional,text,uuid,oneOf,integer} from './fields.js';
import {deadline} from './projects.js';
import {ValidationError} from '../utils/app-error.js';
const input=object({search:optional(text({max:100,pattern:/^[^\u0000-\u001f\u007f]*$/})),actorId:optional(uuid()),action:optional(text({max:80,pattern:/^[A-Z0-9_]+$/})),entityType:optional(text({max:80,pattern:/^[a-z_]+$/})),entityId:optional(uuid()),createdFrom:optional(deadline),createdTo:optional(deadline),sort:optional(oneOf(['newest','oldest']),'newest'),page:optional(integer({min:1,max:10000,coerce:true}),1),pageSize:optional(integer({min:1,max:24,coerce:true}),12)},{field:'query'});
export function auditQuery(value){const query=input(value);if(query.createdFrom&&query.createdTo&&query.createdFrom>query.createdTo)throw new ValidationError([{field:'query.createdTo',message:'Конец периода должен быть не раньше начала'}]);return query;}

import { object } from './object.js';
import { text,uuid,optional,integer,oneOf } from './fields.js';
import { money,deadline } from './projects.js';
export function content(max){
  const parse=text({max});
  return (input,field,issues)=>{
    const value=parse(input,field,issues);
    if(value&&/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value))issues.push({field,message:'Недопустимые управляющие символы'});
    return value;
  };
}
export const proposalCreate=object({message:content(5000),offeredPrice:optional((input,field,issues)=>input===null?null:money()(input,field,issues),null),offeredDeadlineAt:deadline});
const reject=object({reason:optional(content(1000),'CUSTOMER_REJECTED')});
export const proposalReject=input=>reject(input===undefined?{}:input);
export const proposalParams=object({proposalId:uuid()},{field:'params'});
const pageFields={status:optional(oneOf(['PENDING','ACCEPTED','REJECTED','WITHDRAWN'])),page:optional(integer({min:1,max:10000,coerce:true}),1),pageSize:optional(integer({min:1,max:24,coerce:true}),12)};
export const projectProposalQuery=object(pageFields,{field:'query'});
export const ownProposalQuery=object({...pageFields,projectId:optional(uuid())},{field:'query'});

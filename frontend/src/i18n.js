import {english} from './en.js';
import {getLanguage} from './preferences.js';
export const locale=()=>getLanguage()==='en'?'en-GB':'ru-RU';
export function t(message,values=[],language=getLanguage()){
 if(typeof message!=='string')return message;
 const key=message.trim(),translation=language==='en'?english[key]??key:key;
 const leading=message.match(/^\s*/)[0],trailing=message.match(/\s*$/)[0];
 return leading+translation.replace(/\{(\d+)\}/g,(match,index)=>values[index]??match)+trailing;
}
export function errorText(message,fallback='Could not complete the request. Check the form and try again.'){
 if(getLanguage()!=='en')return message;
 if(/^Длина должна быть от \d+ до \d+$/.test(message))return message.replace(/^Длина должна быть от (\d+) до (\d+)$/,'Length must be $1 to $2 characters');
 if(/^Ожидается целое число от/.test(message))return message.replace(/^Ожидается целое число от (.+) до (.+)$/,'Enter a whole number from $1 to $2');
 const result=t(message);
 return /[А-Яа-яЁё]/.test(result)?fallback:result;
}

const notificationTitles={PROPOSAL_CREATED:'New project proposal',PROPOSAL_STATUS_CHANGED:'Proposal status changed',INVITATION_CREATED:'New project invitation',INVITATION_STATUS_CHANGED:'Invitation status changed',ORDER_CREATED:'Order created',SUBMISSION_CREATED:'A new result version was submitted',REVISION_REQUESTED:'The customer requested a revision',ORDER_COMPLETED:'The customer accepted the result',ORDER_CANCELLED:'Order cancelled',DEADLINE_REQUESTED:'New deadline requested',DEADLINE_APPROVED:'New deadline approved',DEADLINE_REJECTED:'Deadline request rejected',DEADLINE_EXPIRED:'Deadline request closed',COMPLAINT_IN_REVIEW:'Your complaint is under review',COMPLAINT_RESOLVED:'Your complaint has been reviewed',MODERATION_ACTION:'An administrator made an account decision'};
export const notificationTitle=item=>getLanguage()==='en'?notificationTitles[item.type]??'New workspace event':item.message;

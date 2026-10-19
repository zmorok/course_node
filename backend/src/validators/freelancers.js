import {object} from './object.js';
import {text,optional,oneOf,integer} from './fields.js';
function rating(input,field,issues){
  if(typeof input!=='string'||!/^(?:[0-4](?:\.\d{1,2})?|5(?:\.0{1,2})?)$/.test(input)){issues.push({field,message:'Нужен рейтинг от 0 до 5, не более двух знаков после точки'});return;}
  return Number(input);
}
export const freelancerQuery=object({search:optional(text({max:100,pattern:/^[^\u0000-\u001f\u007f]*$/})),
  skill:optional(text({max:80,pattern:/^[a-z0-9]+(?:-[a-z0-9]+)*$/})),minRating:optional(rating),
  sort:optional(oneOf(['rating','name']),'rating'),page:optional(integer({min:1,max:10000,coerce:true}),1),pageSize:optional(integer({min:1,max:24,coerce:true}),12)},{field:'query'});

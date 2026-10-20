const sensitive=/password|passwd|secret|token|authorization|cookie|storage_?key|private_?key|hash|credential|api_?key/i;
export function auditData(value,depth=0){
  if(depth>8)return '[Ограничена вложенность]';
  if(value===null||typeof value==='boolean'||typeof value==='number')return value;
  if(typeof value==='string')return value.slice(0,5000).toWellFormed();
  if(value instanceof Date)return Number.isFinite(value.getTime())?value.toISOString():null;
  if(Array.isArray(value))return value.slice(0,100).map(item=>auditData(item,depth+1));
  if(value&&typeof value==='object'){const result=Object.create(null);for(const [key,item] of Object.entries(value)){if(!sensitive.test(key)&&!['__proto__','constructor','prototype'].includes(key)&&item!==undefined)result[key]=auditData(item,depth+1);}return result;}
  return null;
}

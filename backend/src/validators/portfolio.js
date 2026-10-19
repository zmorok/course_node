import { object } from './object.js';
import { text, uuid, optional } from './fields.js';
function content(max,multiline=false) {
  const parse = text({ max });
  return (input,field,issues) => {
    const value = parse(input,field,issues);
    if (value && (multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/ : /[\u0000-\u001f\u007f]/).test(value)) issues.push({ field,message:'Недопустимые управляющие символы' });
    return value;
  };
}
export const portfolioParams = object({ itemId: uuid() },{ field:'params' });
export const portfolioUserParams = object({ userId: uuid() },{ field:'params' });
export const portfolioInput = object({ title: content(200), description: content(5000,true),
  links: optional((input,field,issues) => {
    if (!Array.isArray(input) || input.length > 5) { issues.push({ field,message:'Укажите не более 5 ссылок' }); return; }
    return input.map((link,index) => {
      const value = text({ max:2048 })(link,`${field}.${index}`,issues);
      try {
        const url = new URL(value);
        if (!['http:','https:'].includes(url.protocol) || url.username || url.password || /[\u0000-\u0020\u007f]/.test(value)) throw new Error();
      } catch { issues.push({ field:`${field}.${index}`,message:'Нужна полная ссылка http:// или https:// без логина и пароля' }); }
      return value;
    });
  },[]),
  fileIds: optional((input,field,issues) => {
    if (!Array.isArray(input) || input.length > 8) { issues.push({ field,message:'Можно прикрепить не более 8 файлов' }); return; }
    const ids = input.map((id,index) => uuid()(id,`${field}.${index}`,issues));
    if (new Set(ids).size !== ids.length) issues.push({ field,message:'Файлы не должны повторяться' });
    return ids;
  },[]),
});

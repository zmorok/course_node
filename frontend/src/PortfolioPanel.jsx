import {ErrorMessage} from './Ui.jsx';
import React,{ useEffect,useState } from 'react';
import { api } from './api.js';
import { uploadFile as upload } from './files.js';

const accept='.png,.jpg,.jpeg,.webp,.gif,.bmp,.pdf,.txt,.docx,.zip,.mp4';
const sizeLabel=size=>size<1024*1024?`${Math.max(1,Math.ceil(size/1024))} КБ`:`${(size/1024/1024).toFixed(1)} МБ`;
const empty=()=>({title:'',description:'',experience:'',skills:[],links:[],files:[]});
export function FileLink({file,privateFile=false}) {
  const [error,setError]=useState(null),[busy,setBusy]=useState(false);
  async function download(event) {
    if(!privateFile)return;
    event.preventDefault();setBusy(true);setError(null);
    try {
      const blob=await api(`/files/${file.id}`,{responseType:'blob'}), url=URL.createObjectURL(blob);
      const link=document.createElement('a');link.href=url;link.download=file.originalName;link.click();
      setTimeout(()=>URL.revokeObjectURL(url),1000);
    } catch(problem){setError(problem);} finally{setBusy(false);}
  }
  return <div className="attachment"><a href={`/api/files/${file.id}`} target={privateFile?undefined:'_blank'} rel="noopener noreferrer" onClick={download}
    aria-disabled={busy}>{busy?'Загружаем…':file.originalName}</a><small>{sizeLabel(file.sizeBytes)}</small><ErrorMessage error={error}/></div>;
}
export function AvatarEditor({fileId,onChange}) {
  const [busy,setBusy]=useState(false),[error,setError]=useState(null);
  async function change(event) {
    const file=event.target.files?.[0];event.target.value='';if(!file)return;
    setBusy(true);setError(null);let uploaded;
    try {
      uploaded=await upload(file);
      const result=await api('/me/avatar',{method:'PUT',body:{fileId:uploaded.id}});onChange(result.avatarFileId);
    } catch(problem) {
      setError(problem);
      if(uploaded) await api(`/files/${uploaded.id}`,{method:'DELETE'}).catch(()=>{});
    } finally {setBusy(false);}
  }
  return <div className="avatar-editor"><label className="upload-label">{busy?'Сохраняем…':'Выбрать аватар'}<input type="file" accept=".png,.jpg,.jpeg,.webp,.gif,.bmp" disabled={busy} onChange={change}/></label>
    <p className="profile-help">PNG, JPEG, GIF, BMP или WebP, до 10 МБ. Аватар виден в публичном профиле.</p>
    {fileId&&<button className="text-button" disabled={busy} onClick={async()=>{setBusy(true);setError(null);try{await api('/me/avatar',{method:'DELETE'});onChange(null);}catch(problem){setError(problem);}finally{setBusy(false);}}}>Удалить аватар</button>}
    <ErrorMessage error={error}/></div>;
}

export function PortfolioPanel({userId,editable=false}) {
  const [items,setItems]=useState([]),[available,setAvailable]=useState([]),[loading,setLoading]=useState(true),[attempt,setAttempt]=useState(0);
  const [error,setError]=useState(null),[message,setMessage]=useState(''),[draft,setDraft]=useState(null),[links,setLinks]=useState('');
  const [busy,setBusy]=useState(false),[uploading,setUploading]=useState(false),[confirmId,setConfirmId]=useState(null);
  const path=editable?'/me/portfolio':`/users/${encodeURIComponent(userId)}/portfolio`;
  async function files(){const result=await api('/files');setAvailable(result.files);}
  useEffect(()=>{
    let active=true;setLoading(true);setError(null);
    Promise.all([api(path),editable?api('/files'):Promise.resolve({files:[]})]).then(([data,library])=>{
      if(active){setItems(data.items);setAvailable(library.files);}
    }).catch(problem=>{if(active)setError(problem);}).finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};
  },[path,editable,attempt]);
  function edit(item){setDraft({...item,files:[...item.files]});setLinks(item.links.join('\n'));setError(null);setMessage('');setConfirmId(null);}
  async function save(event){
    event.preventDefault();setBusy(true);setError(null);
    try {
      const {item}=await api(draft.id?`${path}/${draft.id}`:path,{method:draft.id?'PUT':'POST',body:{title:draft.title,description:draft.description,experience:draft.experience,skills:(draft.skills??[]).map(value=>value.trim()).filter(Boolean),
        links:links.split('\n').map(value=>value.trim()).filter(Boolean),fileIds:draft.files.map(file=>file.id)}});
      setItems(previous=>draft.id?previous.map(value=>value.id===item.id?item:value):[item,...previous]);setDraft(null);setMessage('Работа сохранена');
      await files();
    }catch(problem){setError(problem);}finally{setBusy(false);}
  }
  async function addFile(event){
    const file=event.target.files?.[0];event.target.value='';if(!file)return;setUploading(true);setError(null);
    try{const saved=await upload(file);setDraft(previous=>({...previous,files:[...previous.files,saved]}));await files();}
    catch(problem){setError(problem);}finally{setUploading(false);}
  }
  async function removeItem(id){
    setBusy(true);setError(null);
    try{await api(`${path}/${id}`,{method:'DELETE'});setItems(previous=>previous.filter(item=>item.id!==id));setConfirmId(null);setMessage('Работа и её вложения удалены');await files();}
    catch(problem){setError(problem);}finally{setBusy(false);}
  }
  const locked=busy||uploading;
  return <section className="profile-card portfolio-panel" aria-labelledby="portfolio-heading">
    <div className="portfolio-heading"><div><p className="eyebrow">Опыт в деле</p><h2 id="portfolio-heading">Портфолио</h2></div>
      {editable&&!draft&&<button className="secondary" disabled={locked||loading} onClick={()=>edit(empty())}>+ Добавить работу</button>}</div>
    <p className="profile-help">{editable?'Расскажите о своих работах. Сохранённые работы и вложения видны всем в публичном профиле.':'Проекты и результаты, которыми поделился пользователь.'}</p>
    {loading?<p role="status">Загружаем портфолио…</p>:<>
      <ErrorMessage error={error}/>{error&&!draft&&<button className="text-button" onClick={()=>setAttempt(value=>value+1)}>Обновить список</button>}
      {draft&&<form className="portfolio-form" onSubmit={save}><fieldset disabled={locked}><legend>{draft.id?'Редактирование работы':'Новая работа'}</legend>
        <div className="field"><label htmlFor="portfolio-title">Название работы</label><input id="portfolio-title" required maxLength={200} value={draft.title} onChange={event=>setDraft({...draft,title:event.target.value})}/></div>
        <div className="field"><label htmlFor="portfolio-description">Описание работы</label><textarea id="portfolio-description" required maxLength={5000} rows={5} value={draft.description} onChange={event=>setDraft({...draft,description:event.target.value})}/></div>
        <div className="field"><label htmlFor="portfolio-experience">Опыт и ваша роль в работе</label><textarea id="portfolio-experience" maxLength={5000} value={draft.experience??''} onChange={event=>setDraft({...draft,experience:event.target.value})}/></div>
        <div className="field"><label htmlFor="portfolio-skills">Навыки этой работы через запятую</label><input id="portfolio-skills" maxLength={5000} value={(draft.skills??[]).join(',')} onChange={event=>setDraft({...draft,skills:event.target.value.split(',')})}/></div>
        <div className="field"><label htmlFor="portfolio-links">Ссылки на результат</label><textarea id="portfolio-links" rows={2} value={links} onChange={event=>setLinks(event.target.value)} aria-describedby="portfolio-links-help"/>
          <small id="portfolio-links-help">До 5 ссылок http:// или https://, каждая с новой строки.</small></div>
        <div className="portfolio-attachments"><h3>Вложения · {draft.files.length}/8</h3>
          {draft.files.map(file=><div className="attachment-row" key={file.id}><FileLink file={file} privateFile/><button type="button" className="text-button danger" onClick={()=>setDraft({...draft,files:draft.files.filter(value=>value.id!==file.id)})}>Убрать</button></div>)}
          <label className={`upload-label ${draft.files.length>=8?'disabled':''}`}>{uploading?'Загружаем…':'+ Загрузить файл'}<input type="file" accept={accept} disabled={draft.files.length>=8||locked} onChange={addFile}/></label>
          <p className="profile-help">PNG, JPEG, WebP, GIF, BMP, PDF, TXT, DOCX, ZIP, MP4. До 10 МБ на файл.</p>
          {draft.files.length<8&&available.filter(file=>!file.inUse&&!draft.files.some(value=>value.id===file.id)).length>0&&<div className="available-files"><p className="profile-help">Или прикрепите загруженный файл:</p>
            {available.filter(file=>!file.inUse&&!draft.files.some(value=>value.id===file.id)).map(file=><button type="button" key={file.id} className="file-choice" onClick={()=>setDraft({...draft,files:[...draft.files,file]})}>+ {file.originalName}</button>)}</div>}
        </div><div className="profile-form-actions"><button type="submit">{busy?'Сохраняем…':'Сохранить работу'}</button><button type="button" className="secondary" onClick={()=>{setDraft(null);setError(null);}}>Отменить</button></div>
        <p className="profile-help">Убранные вложения удалятся при сохранении. После отмены новые загрузки останутся в свободных файлах.</p>
      </fieldset></form>}
      <div className="portfolio-items">{items.map(item=><article className="portfolio-item" key={item.id}>
        {item.files.find(file=>file.mimeType.startsWith('image/'))&&<img className="portfolio-cover" src={`/api/files/${item.files.find(file=>file.mimeType.startsWith('image/')).id}`} alt="" loading="lazy"/>}
        <div className="portfolio-item-body"><h3>{item.title}</h3><p className="public-description">{item.description}</p>{item.experience&&<p className="public-description">{item.experience}</p>}<div className="profile-tags">{(item.skills??[]).map(skill=><span key={skill}>{skill}</span>)}</div>
          {item.links.length>0&&<ul className="portfolio-links">{item.links.map((link,index)=><li key={`${index}-${link}`}><a href={link} target="_blank" rel="noopener noreferrer">{link} ↗</a></li>)}</ul>}
          <div className="attachment-list">{item.files.map(file=><FileLink key={file.id} file={file}/>)}</div>
          {editable&&<div className="portfolio-actions"><button className="text-button" disabled={locked||Boolean(draft)} onClick={()=>edit(item)}>Редактировать</button>
            {confirmId===item.id?<><span>Удалить работу и вложения?</span><button className="text-button danger" disabled={locked} onClick={()=>removeItem(item.id)}>Да, удалить</button><button className="text-button" disabled={locked} onClick={()=>setConfirmId(null)}>Отмена</button></>
              :<button className="text-button danger" disabled={locked||Boolean(draft)} onClick={()=>setConfirmId(item.id)}>Удалить работу</button>}</div>}
        </div></article>)}</div>
      {!items.length&&!draft&&<div className="portfolio-empty">{editable?'Здесь появятся ваши проекты, примеры работ и результаты.':'Пользователь пока не добавил работы.'}</div>}
      {editable&&available.some(file=>!file.inUse)&&!draft&&<details className="unused-files"><summary>Свободные файлы · {available.filter(file=>!file.inUse).length}</summary>
        <p className="profile-help">Доступны только вам. Прикрепите их к работе или удалите.</p>{available.filter(file=>!file.inUse).map(file=><div className="attachment-row" key={file.id}><FileLink file={file} privateFile/>
          <button className="text-button danger" disabled={locked} onClick={async()=>{setBusy(true);setError(null);try{await api(`/files/${file.id}`,{method:'DELETE'});await files();}catch(problem){setError(problem);}finally{setBusy(false);}}}>Удалить файл</button></div>)}</details>}
    </>}
    <p className="save-message" role="status">{message}</p>
  </section>;
}

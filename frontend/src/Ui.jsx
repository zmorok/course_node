import React,{useEffect,useState} from 'react';
import {api} from './api.js';

export function ErrorMessage({error}) {
  if(!error)return null;
  const details=[...new Set(error.details?.map(issue=>issue.message)??[])];
  return <div className="form-error" role="alert"><strong>{error.message}</strong>{details.length>0&&<ul>{details.map(message=><li key={message}>{message}</li>)}</ul>}</div>;
}
export function StatusBadge({status,labels}) {
  return <span className={`project-status status-${String(status).toLowerCase()}`}>{labels?.[status]??status}</span>;
}
export function Pagination({data,page=data.page,onPage,href,label='Страницы списка',disabled=false}) {
  if(!data.total)return null;
  const pages=Math.ceil(data.total/data.pageSize);
  const link=(next,text)=>href?<a href={href(next)}>{text}</a>:<button className="text-button" disabled={disabled} onClick={()=>onPage(next)}>{text}</button>;
  if(page>pages)return <nav className="project-pagination" aria-label={label}><span>На этой странице записей нет</span>{link(1,'В начало списка')}</nav>;
  return <nav className="project-pagination" aria-label={label}>{page>1&&link(page-1,'← Назад')}<span aria-live="polite">Страница {page} из {pages}</span>{page*data.pageSize<data.total&&link(page+1,'Далее →')}</nav>;
}
export function listPage(page){const next=new URLSearchParams(window.location.search);next.set('page',page);window.location.assign(`${window.location.pathname}?${next}`);}
export function useRemote(path){
  const [entry,setEntry]=useState({path,data:null,error:null,loading:true});
  useEffect(()=>{let active=true;setEntry({path,data:null,error:null,loading:true});api(path).then(data=>{if(active)setEntry({path,data,error:null,loading:false});}).catch(error=>{if(active)setEntry({path,data:null,error,loading:false});});return()=>{active=false;};},[path]);
  async function reload(){try{const data=await api(path);setEntry({path,data,error:null,loading:false});}catch(error){setEntry({path,data:null,error,loading:false});throw error;}}
  const current=entry.path===path?entry:{data:null,error:null,loading:true};return {...current,reload};
}
export function RemoteState({remote,children}){return remote.loading?<section className="profile-card" role="status">Загружаем данные…</section>:remote.error?<section className="profile-card"><ErrorMessage error={remote.error}/><button className="secondary" onClick={()=>remote.reload().catch(()=>{})}>Повторить загрузку</button></section>:children;}
export function Pages({data,onPage}){return <Pagination data={data} onPage={onPage}/>;}

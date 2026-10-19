import React,{useEffect,useState} from 'react';
import {api} from './api.js';
export function FreelancerPage(){
  const query=window.location.search,initial=Object.fromEntries(new URLSearchParams(query));
  const [filters,setFilters]=useState({search:initial.search??'',skill:initial.skill??'',minRating:initial.minRating??'',sort:initial.sort??'rating'});
  const [data,setData]=useState(null),[skills,setSkills]=useState([]),[loading,setLoading]=useState(true),[error,setError]=useState(null),[attempt,setAttempt]=useState(0);
  useEffect(()=>{let active=true;setLoading(true);setError(null);Promise.all([api(`/freelancers${query}`),api('/skills')]).then(([result,catalog])=>{if(active){setData(result);setSkills(catalog.skills);}}).catch(problem=>{if(active)setError(problem);}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[query,attempt]);
  function filter(event){event.preventDefault();const params=new URLSearchParams();for(const [key,value]of Object.entries(filters))if(value)params.set(key,value);window.location.assign(`/freelancers?${params}`);}
  function pageUrl(page){const params=new URLSearchParams(query);params.set('page',page);return `/freelancers?${params}`;}
  const select=(key,label,options)=><div className="field"><label htmlFor={`freelancer-${key}`}>{label}</label><select id={`freelancer-${key}`} value={filters[key]} onChange={event=>setFilters({...filters,[key]:event.target.value})}>{options.map(([value,name])=><option key={value} value={value}>{name}</option>)}</select></div>;
  return <><div className="profile-page-heading"><div><p className="eyebrow">Люди для ваших проектов</p><h1>Найти исполнителя</h1><p className="profile-help">Выберите специалиста по навыкам, познакомьтесь с работами и предложите проект.</p></div><a className="text-link" href="/projects">Каталог проектов ↗</a></div>
    <div className="projects-layout"><aside className="profile-card project-filters"><form onSubmit={filter}><h2>Поиск и фильтры</h2><div className="field"><label htmlFor="freelancer-search">Имя или username</label><input id="freelancer-search" type="search" maxLength={100} value={filters.search} onChange={event=>setFilters({...filters,search:event.target.value})}/></div>
      {select('skill','Навык',[['','Любой навык'],...skills.map(skill=>[skill.slug,skill.name])])}{select('minRating','Минимальный рейтинг',[['','Любой, включая без отзывов'],['3','3 и выше'],['4','4 и выше'],['4.5','4,5 и выше'],['5','5']])}
      {select('sort','Сортировка',[['rating','Сначала по рейтингу'],['name','По имени']])}<button type="submit" className="submit">Найти исполнителей <span aria-hidden="true">↗</span></button><a className="filter-reset text-link" href="/freelancers">Сбросить</a>
    </form></aside><section className="project-results" aria-label="Исполнители">
      {loading?<div className="profile-card" role="status">Загружаем исполнителей…</div>:error?<div className="profile-card"><p className="form-error" role="alert">{error.message}</p><button className="secondary" onClick={()=>setAttempt(value=>value+1)}>Повторить</button></div>:<>
        <p className="project-result-count" role="status">Найдено исполнителей: {data.total}</p>{data.items.map(person=><article className="profile-card freelancer-card" key={person.id}>
          <div className="freelancer-heading"><div className="profile-avatar">{person.avatarFileId?<img src={`/api/files/${person.avatarFileId}`} alt=""/>:`${person.firstName[0]}${person.lastName[0]}`}</div><div><h2><a href={`/users/${person.id}`}>{person.firstName} {person.lastName}</a></h2><p className="profile-handle">@{person.username}</p></div><span className="freelancer-rating">{person.freelancerRating===null?'Без отзывов':`★ ${new Intl.NumberFormat('ru-RU',{maximumFractionDigits:2}).format(Number(person.freelancerRating))}`}<small>Отзывов: {person.freelancerReviewCount}</small></span></div>
          <p className="public-description">{person.headline||'Специалист пока не добавил описание.'}</p>{(person.city||person.country)&&<p className="profile-location">{[person.city,person.country].filter(Boolean).join(', ')}</p>}
          <div className="profile-tags">{person.skills.map(skill=><span key={skill.id}>{skill.name}</span>)}</div><a className="text-link" href={`/users/${person.id}`}>Профиль и приглашение в проект ↗</a>
        </article>)}
        {!data.items.length&&<div className="profile-card project-empty"><h2>Исполнители не найдены</h2><p className="profile-help">Попробуйте изменить поиск или фильтры. Рейтинг появляется после первых отзывов.</p><a className="text-link" href="/freelancers">Вернуться ко всем исполнителям</a></div>}
        {data.total>0&&<nav className="project-pagination" aria-label="Страницы исполнителей">{data.page>1&&<a href={pageUrl(data.page-1)}>← Назад</a>}<span>Страница {data.page} из {Math.ceil(data.total/data.pageSize)}</span>{data.page*data.pageSize<data.total&&<a href={pageUrl(data.page+1)}>Далее →</a>}</nav>}
      </>}
    </section></div></>;
}

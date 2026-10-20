import {ErrorMessage} from './Ui.jsx';
import React,{useEffect,useState} from 'react';
import {api} from './api.js';
import {Agreement} from './ProposalPages.jsx';
const statuses={PENDING:'Ожидает ответа',ACCEPTED:'Принято',DECLINED:'Отклонено',EXPIRED:'Закрыто'};
const reasons={RECIPIENT_DECLINED:'Исполнитель отклонил приглашение',TERMS_CHANGED:'Условия проекта изменились',PROJECT_CANCELLED:'Проект отменён',OTHER_SOURCE_ACCEPTED:'На проект выбран исполнитель',TERMS_EXPIRED:'Предложенный срок работы истёк',TIME_EXPIRED:'Срок ответа истёк'};
const date=value=>value?new Date(value).toLocaleString('ru-RU',{day:'numeric',month:'long',year:'numeric',hour:'2-digit',minute:'2-digit'}):'Не ограничен';
const price=value=>value===null?'Не указана':new Intl.NumberFormat('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(value));
const localDate=value=>value?new Date(new Date(value).getTime()-new Date(value).getTimezoneOffset()*60000).toISOString().slice(0,16):'';

export function InvitationComposer({profile,user}){
  const [projects,setProjects]=useState([]),[loading,setLoading]=useState(true),[loadError,setLoadError]=useState(null),[error,setError]=useState(null),[attempt,setAttempt]=useState(0),[busy,setBusy]=useState(false),[sent,setSent]=useState(false);
  const [draft,setDraft]=useState({projectId:'',message:'',offeredPrice:'',offeredDeadlineAt:'',expiresAt:''});
  const eligible=user?.role==='CLIENT'&&user.id!==profile.id;
  useEffect(()=>{if(!eligible)return;let active=true;setLoading(true);setLoadError(null);api(`/freelancers/${profile.id}/projects`).then(result=>{if(active)setProjects(result.projects);}).catch(problem=>{if(active)setLoadError(problem);}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[profile.id,user?.id,eligible,attempt]);
  if(!user)return <section className="profile-card"><h2>Предложите совместную работу</h2><p className="profile-help">Войдите, чтобы пригласить специалиста в свой открытый проект.</p><a className="text-link" href="/">Войти в аккаунт ↗</a></section>;
  if(!eligible)return null;
  async function send(event){event.preventDefault();if(!Number.isFinite(new Date(draft.offeredDeadlineAt).getTime())||draft.expiresAt&&!Number.isFinite(new Date(draft.expiresAt).getTime())){setError({message:'Укажите корректные дату и время.'});return;}
    setBusy(true);setError(null);try{await api(`/projects/${draft.projectId}/invitations`,{method:'POST',body:{freelancerId:profile.id,message:draft.message,offeredPrice:draft.offeredPrice||null,offeredDeadlineAt:new Date(draft.offeredDeadlineAt).toISOString(),expiresAt:draft.expiresAt?new Date(draft.expiresAt).toISOString():null}});setSent(true);setAttempt(value=>value+1);setDraft({...draft,projectId:'',message:'',offeredPrice:'',offeredDeadlineAt:'',expiresAt:''});}catch(problem){setError(problem);}finally{setBusy(false);}}
  function choose(projectId){const project=projects.find(item=>item.id===projectId);setSent(false);setDraft({...draft,projectId,offeredPrice:project?.budget??'',offeredDeadlineAt:project?.desiredDeadlineAt&&new Date(project.desiredDeadlineAt)>new Date()?localDate(project.desiredDeadlineAt):''});}
  return <section className="profile-card"><p className="eyebrow">От знакомства к работе</p><h2>Пригласить в проект</h2><p className="profile-help">Предложите специалисту задание, цену и срок. Заказ появится после принятия приглашения исполнителем.</p>
    {sent&&<p className="save-message" role="status">Приглашение отправлено. Ответ появится в разделе «Приглашения».</p>}
    {loading?<p role="status">Загружаем ваши открытые проекты…</p>:loadError?<><ErrorMessage error={loadError}/><button className="secondary" onClick={()=>setAttempt(value=>value+1)}>Повторить загрузку</button></>:projects.length?<form className="proposal-form" onSubmit={send}><fieldset disabled={busy}>
      <div className="field"><label htmlFor="invitation-project">Ваш открытый проект</label><select id="invitation-project" required value={draft.projectId} onChange={event=>choose(event.target.value)}><option value="">Выберите проект</option>{projects.map(project=><option key={project.id} value={project.id}>{project.title}</option>)}</select></div>
      <div className="field"><label htmlFor="invitation-message">Сообщение исполнителю</label><textarea id="invitation-message" required maxLength={5000} rows={4} value={draft.message} onChange={event=>setDraft({...draft,message:event.target.value})}/></div>
      <div className="profile-fields"><div className="field"><label htmlFor="invitation-price">Предлагаемая цена (необязательно)</label><input id="invitation-price" type="number" min="0.01" max="9999999999.99" step="0.01" value={draft.offeredPrice} onChange={event=>setDraft({...draft,offeredPrice:event.target.value})}/><small>Пустое поле означает, что цена не указана.</small></div>
      <div className="field"><label htmlFor="invitation-deadline">Срок выполнения работы</label><input id="invitation-deadline" type="datetime-local" required value={draft.offeredDeadlineAt} onChange={event=>setDraft({...draft,offeredDeadlineAt:event.target.value})}/></div>
      <div className="field"><label htmlFor="invitation-expires">Ответить до (необязательно)</label><input id="invitation-expires" type="datetime-local" value={draft.expiresAt} onChange={event=>setDraft({...draft,expiresAt:event.target.value})}/><small>Оставьте пустым, чтобы не ограничивать время ответа отдельно.</small></div></div>
      <button type="submit">{busy?'Отправляем…':'Отправить приглашение ↗'}</button>
    </fieldset></form>:<p className="portfolio-empty">Нет доступных проектов: опубликуйте задание или дождитесь ответа на уже отправленное приглашение.</p>}
    <ErrorMessage error={error}/><div className="proposal-actions"><a className="text-link" href="/me/invitations?box=sent">Отправленные приглашения ↗</a><a className="text-link" href="/projects/new">Создать проект ↗</a></div>
  </section>;
}

function InvitationCard({invitation,onChange}){
  const [action,setAction]=useState(null),[reason,setReason]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(null);
  async function decide(event){event.preventDefault();setBusy(true);setError(null);try{const result=await api(`/invitations/${invitation.id}/${action}`,{method:'POST',body:action==='decline'&&reason.trim()?{reason}:{}});setAction(null);onChange(result.invitation);}catch(problem){setError(problem);}finally{setBusy(false);}}
  return <article className="proposal-card"><div className="project-card-top"><span className={`project-status status-${invitation.status.toLowerCase()}`}>{invitation.expired?'Срок истёк':statuses[invitation.status]}</span><span className="proposal-created">{date(invitation.createdAt)}</span></div>
    <h3>{invitation.project.status==='OPEN'?<a className="text-link" href={`/projects/${invitation.project.id}`}>{invitation.project.title}</a>:invitation.project.title}</h3><p className="proposal-parties"><a href={`/users/${invitation.customer.id}`}>{invitation.customer.firstName} {invitation.customer.lastName}</a><span> → </span><a href={`/users/${invitation.freelancer.id}`}>{invitation.freelancer.firstName} {invitation.freelancer.lastName}</a></p>
    <p className="public-description">{invitation.message}</p><dl className="proposal-terms"><div><dt>Предложенная цена</dt><dd>{price(invitation.offeredPrice)}</dd></div><div><dt>Срок работы</dt><dd>{date(invitation.offeredDeadlineAt)}</dd></div><div><dt>Срок ответа</dt><dd>{date(invitation.expiresAt)}</dd></div></dl>
    {invitation.closureReason&&<p className="proposal-reason">{reasons[invitation.closureReason]??invitation.closureReason}</p>}{invitation.expired&&<p className="profile-help">Срок истёк. Для начала работы потребуется новое приглашение.</p>}{invitation.order&&<Agreement order={invitation.order}/>}
    {!action&&invitation.canRespond&&<div className="proposal-actions"><button onClick={()=>{setAction('accept');setError(null);}}>Принять приглашение ↗</button><button className="secondary" onClick={()=>{setAction('decline');setError(null);}}>Отклонить приглашение</button></div>}
    {action&&<form className="proposal-confirm" onSubmit={decide}><fieldset disabled={busy}>{action==='accept'?<><h4>Принять приглашение?</h4><p>Цена: {price(invitation.offeredPrice)}. Срок работы: {date(invitation.offeredDeadlineAt)}.</p><p>Будет создан заказ между вами и заказчиком. Проект перейдёт в работу, остальные ожидающие предложения закроются.</p></>:<div className="field"><label htmlFor={`decline-${invitation.id}`}>Причина отказа (необязательно)</label><textarea id={`decline-${invitation.id}`} rows={3} maxLength={1000} value={reason} onChange={event=>setReason(event.target.value)}/></div>}
      <div className="proposal-actions"><button type="submit">{busy?'Сохраняем…':action==='accept'?'Принять и создать заказ':'Подтвердить отказ'}</button><button type="button" className="secondary" onClick={()=>setAction(null)}>Назад</button></div>
    </fieldset></form>}<ErrorMessage error={error}/>
  </article>;
}
export function InvitationList({path,revision}){
  const [data,setData]=useState(null),[status,setStatus]=useState(''),[page,setPage]=useState(1),[loading,setLoading]=useState(true),[error,setError]=useState(null),[attempt,setAttempt]=useState(0),[completed,setCompleted]=useState(null);
  useEffect(()=>{let active=true;setLoading(true);setError(null);const params=new URLSearchParams(path.split('?')[1]??'');if(status)params.set('status',status);params.set('page',page);api(`${path.split('?')[0]}?${params}`).then(result=>{if(active)setData(result);}).catch(problem=>{if(active)setError(problem);}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[path,status,page,attempt,revision]);
  return <div className="proposal-list"><div className="proposal-toolbar"><div className="field"><label htmlFor="invitation-status">Статус приглашений</label><select id="invitation-status" value={status} onChange={event=>{setStatus(event.target.value);setPage(1);}}><option value="">Все статусы</option>{Object.entries(statuses).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></div><button className="text-button" disabled={loading} onClick={()=>setAttempt(value=>value+1)}>Обновить приглашения</button></div>
    {completed&&<p className="save-message" role="status">{completed.order?'Приглашение принято. Заказ создан.':'Приглашение отклонено.'}</p>}{completed?.order&&(loading||!data?.items.some(row=>row.id===completed.id))&&<Agreement order={completed.order}/>}
    {loading?<p role="status">Загружаем приглашения…</p>:error?<><ErrorMessage error={error}/><button className="secondary" onClick={()=>setAttempt(value=>value+1)}>Повторить</button></>:<>
      {!data.items.length&&<p className="portfolio-empty">{data.total?'На этой странице приглашений нет. Вернитесь назад.':'Приглашений пока нет. Здесь появятся предложения и ответы на них.'}</p>}
      {data.items.map(invitation=><InvitationCard key={invitation.id} invitation={invitation} onChange={value=>{setCompleted(value);setAttempt(attempt=>attempt+1);}}/>)}
      {data.total>0&&<nav className="project-pagination" aria-label="Страницы приглашений">{page>1&&<button className="text-button" onClick={()=>setPage(page-1)}>← Назад</button>}<span>Страница {data.page} из {Math.ceil(data.total/data.pageSize)}</span>{page*data.pageSize<data.total&&<button className="text-button" onClick={()=>setPage(page+1)}>Далее →</button>}</nav>}
    </>}
  </div>;
}
export function OwnInvitationsPage({user}){
  if(user.role!=='CLIENT')return <section className="profile-card"><h1>Приглашения доступны клиенту</h1><a className="text-link" href="/freelancers">Найти исполнителя</a></section>;
  const box=new URLSearchParams(window.location.search).get('box')??'incoming';
  if(!['incoming','sent'].includes(box))return <section className="profile-card"><h1>Неизвестный список приглашений</h1><a className="text-link" href="/me/invitations">К входящим</a></section>;
  return <><div className="profile-page-heading"><div><p className="eyebrow">Предложение начать вместе</p><h1>Приглашения</h1><p className="profile-help">{box==='sent'?'Ответы исполнителей на ваши предложения.':'Заказчики предлагают вам свои проекты.'}</p></div><a className="text-link" href="/freelancers">Найти исполнителя ↗</a></div><section className="profile-card"><nav className="invitation-tabs" aria-label="Списки приглашений"><a href="/me/invitations" aria-current={box==='incoming'?'page':undefined}>Входящие</a><a href="/me/invitations?box=sent" aria-current={box==='sent'?'page':undefined}>Отправленные</a></nav><InvitationList key={box} path={`/me/invitations?box=${box}`}/></section></>;
}

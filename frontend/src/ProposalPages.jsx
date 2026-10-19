import React,{useEffect,useState} from 'react';
import {api} from './api.js';
import {FileLink} from './PortfolioPanel.jsx';

const statuses={PENDING:'Ожидает решения',ACCEPTED:'Принят',REJECTED:'Отклонён',WITHDRAWN:'Отозван'};
const reasons={AUTHOR_WITHDRAWN:'Отозван исполнителем',CUSTOMER_REJECTED:'Отклонён заказчиком',TERMS_CHANGED:'Условия проекта изменились',PROJECT_CANCELLED:'Проект отменён',OTHER_SOURCE_ACCEPTED:'Выбран другой исполнитель',TERMS_EXPIRED:'Предложенный срок истёк'};
const price=value=>value===null?'Не указана':new Intl.NumberFormat('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(value));
const date=value=>new Date(value).toLocaleString('ru-RU',{day:'numeric',month:'long',year:'numeric',hour:'2-digit',minute:'2-digit'});
function ErrorMessage({error}){return error?<div className="form-error" role="alert">{error.message}{error.details?.map(issue=><small key={issue.field}>{issue.message}</small>)}</div>:null;}

function Agreement({order}){
  return <section className="proposal-agreement" aria-label="Согласованные условия заказа"><p className="eyebrow">Заказ создан</p><h3>{order.title}</h3>
    <p className="profile-help">Условия и вложения зафиксированы при принятии отклика.</p><dl className="proposal-terms"><div><dt>Согласованная цена</dt><dd>{price(order.agreedPrice)}</dd></div><div><dt>Согласованный срок</dt><dd>{date(order.initialDeadlineAt)}</dd></div></dl>
    <details><summary>Описание и файлы задания</summary><p className="public-description">{order.description}</p>{order.files.length?<div className="attachment-list">{order.files.map(file=><FileLink key={file.id} file={file} privateFile/>)}</div>:<p className="profile-help">Вложений нет.</p>}</details>
  </section>;
}
function ProposalCard({proposal,onChange}){
  const [action,setAction]=useState(null),[reason,setReason]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(null);
  async function decide(event){event.preventDefault();setBusy(true);setError(null);try{
    const result=await api(`/proposals/${proposal.id}/${action}`,{method:'POST',body:action==='reject'&&reason.trim()?{reason}: {}});
    setAction(null);setReason('');onChange(result.proposal);
  }catch(problem){setError(problem);}finally{setBusy(false);}}
  const choose=kind=>{setAction(kind);setError(null);};
  return <article className="proposal-card">
    <div className="project-card-top"><span className={`project-status status-${proposal.status.toLowerCase()}`}>{proposal.expired?'Срок истёк':statuses[proposal.status]}</span><span className="proposal-created">{date(proposal.createdAt)}</span></div>
    <h3>{proposal.project.status==='OPEN'?<a className="text-link" href={`/projects/${proposal.project.id}`}>{proposal.project.title}</a>:proposal.project.title}</h3>
    <p className="proposal-parties"><a href={`/users/${proposal.freelancer.id}`}>{proposal.freelancer.firstName} {proposal.freelancer.lastName}</a><span> → </span><a href={`/users/${proposal.customer.id}`}>{proposal.customer.firstName} {proposal.customer.lastName}</a></p>
    <p className="public-description">{proposal.message}</p><dl className="proposal-terms"><div><dt>Предложенная цена</dt><dd>{price(proposal.offeredPrice)}</dd></div><div><dt>Предложенный срок</dt><dd>{date(proposal.offeredDeadlineAt)}</dd></div></dl>
    {proposal.closureReason&&<p className="proposal-reason">{reasons[proposal.closureReason]??proposal.closureReason}</p>}
    {proposal.expired&&<p className="profile-help">Этот отклик уже нельзя принять. Исполнитель может отправить новый с актуальным сроком.</p>}
    {proposal.order&&<Agreement order={proposal.order}/>}
    {!action&&<div className="proposal-actions">{proposal.canDecide&&<><button disabled={busy} onClick={()=>choose('accept')}>Принять отклик ↗</button><button className="secondary" disabled={busy} onClick={()=>choose('reject')}>Отклонить</button></>}{proposal.canWithdraw&&<button className="text-button" disabled={busy} onClick={()=>choose('withdraw')}>Отозвать отклик</button>}</div>}
    {action&&<form className="proposal-confirm" onSubmit={decide}><fieldset disabled={busy}>
      {action==='accept'?<><h4>Принять предложение?</h4><p>Исполнитель: {proposal.freelancer.firstName} {proposal.freelancer.lastName}. Цена: {price(proposal.offeredPrice)}. Срок: {date(proposal.offeredDeadlineAt)}.</p><p>Будет создан заказ, проект перейдёт в работу, остальные ожидающие предложения закроются.</p></>
        :action==='withdraw'?<p>Отозвать предложение? Оно останется в истории, и вы сможете откликнуться снова.</p>:<div className="field"><label htmlFor={`reject-${proposal.id}`}>Причина отклонения (необязательно)</label><textarea id={`reject-${proposal.id}`} rows={3} maxLength={1000} value={reason} onChange={event=>setReason(event.target.value)}/></div>}
      <div className="proposal-actions"><button type="submit">{busy?'Сохраняем…':action==='accept'?'Подтвердить и создать заказ':action==='reject'?'Подтвердить отклонение':'Подтвердить отзыв'}</button><button type="button" className="secondary" onClick={()=>setAction(null)}>Назад</button></div>
    </fieldset></form>}<ErrorMessage error={error}/>
  </article>;
}

function ProposalList({path,onChange,pendingOnly=false}){
  const [status,setStatus]=useState(pendingOnly?'PENDING':''),[page,setPage]=useState(1),[attempt,setAttempt]=useState(0),[data,setData]=useState(null),[loading,setLoading]=useState(true),[error,setError]=useState(null),[completed,setCompleted]=useState(null);
  useEffect(()=>{let active=true;setLoading(true);setError(null);const params=new URLSearchParams(path.includes('?')?path.split('?')[1]:'');params.set('page',page);if(status)params.set('status',status);
    api(`${path.split('?')[0]}?${params}`).then(result=>{if(active)setData(result);}).catch(problem=>{if(active)setError(problem);}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};
  },[path,status,page,attempt]);
  function changed(proposal){setCompleted(proposal);setAttempt(value=>value+1);onChange?.(proposal);}
  return <div className="proposal-list">
    {!pendingOnly&&<div className="proposal-toolbar"><div className="field"><label htmlFor="proposal-status">Статус откликов</label><select id="proposal-status" value={status} onChange={event=>{setStatus(event.target.value);setPage(1);}}><option value="">Все статусы</option>{Object.entries(statuses).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></div><button className="text-button" disabled={loading} onClick={()=>setAttempt(value=>value+1)}>Обновить список</button></div>}
    {completed&&<p className="save-message" role="status">{completed.order?'Отклик принят. Заказ создан, проект в работе.':completed.status==='WITHDRAWN'?'Отклик отозван.':'Отклик отклонён.'}</p>}
    {completed?.order&&(loading||!data?.items.some(item=>item.id===completed.id))&&<Agreement order={completed.order}/>}
    {loading?<p role="status">Загружаем отклики…</p>:error?<><ErrorMessage error={error}/><button className="secondary" onClick={()=>setAttempt(value=>value+1)}>Повторить загрузку</button></>:<>
      {!data.items.length&&<p className="portfolio-empty">{data.total?'На этой странице откликов нет. Вернитесь назад.':pendingOnly?'Ожидающих откликов нет.':'Откликов пока нет. Здесь появятся предложения и история решений.'}</p>}
      {data.items.map(proposal=><ProposalCard key={proposal.id} proposal={proposal} onChange={changed}/>)}
      {data.total>0&&<nav className="project-pagination" aria-label="Страницы откликов">{page>1&&<button className="text-button" onClick={()=>setPage(page-1)}>← Назад</button>}<span>Страница {data.page} из {Math.ceil(data.total/data.pageSize)}</span>{page*data.pageSize<data.total&&<button className="text-button" onClick={()=>setPage(page+1)}>Далее →</button>}</nav>}
    </>}
  </div>;
}

export function ProjectProposals({project,user,onProjectChange}){
  const [pending,setPending]=useState(null),[loading,setLoading]=useState(true),[checked,setChecked]=useState(false),[error,setError]=useState(null),[attempt,setAttempt]=useState(0),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
  const [draft,setDraft]=useState({message:'',offeredPrice:'',offeredDeadlineAt:''});
  const eligible=user?.role==='CLIENT'&&!project.isOwn&&project.status==='OPEN';
  useEffect(()=>{if(!eligible)return;let active=true;setLoading(true);setChecked(false);setError(null);api(`/me/proposals?projectId=${project.id}&status=PENDING&pageSize=1`).then(data=>{if(active){setPending(data.items[0]??null);setChecked(true);}})
    .catch(problem=>{if(active)setError(problem);}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[project.id,user?.id,eligible,attempt]);
  if(project.isOwn&&user?.role==='CLIENT')return <section className="profile-card"><p className="eyebrow">{project.status==='OPEN'?'Выберите исполнителя':'История предложений'}</p><h2>Отклики на проект</h2><p className="profile-help">{project.status==='OPEN'?'Примите подходящее предложение, чтобы зафиксировать условия и начать работу.':'Предложения, принятые решения и зафиксированные условия заказа.'}</p><ProposalList path={`/projects/${project.id}/proposals`} onChange={proposal=>{if(proposal.order)onProjectChange();}}/></section>;
  if(!user&&project.status==='OPEN')return <section className="profile-card"><h2>Готовы взяться за проект?</h2><p className="profile-help">Войдите в аккаунт, чтобы предложить свои условия.</p><a className="text-link" href="/">Войти или зарегистрироваться ↗</a></section>;
  if(!eligible)return null;
  async function send(event){event.preventDefault();if(!Number.isFinite(new Date(draft.offeredDeadlineAt).getTime())){setError({message:'Укажите дату и время выполнения.'});return;}setBusy(true);setError(null);setMessage('');try{
    const result=await api(`/projects/${project.id}/proposals`,{method:'POST',body:{message:draft.message,offeredPrice:draft.offeredPrice||null,offeredDeadlineAt:new Date(draft.offeredDeadlineAt).toISOString()}});
    setPending(result.proposal);setDraft({message:'',offeredPrice:'',offeredDeadlineAt:''});setMessage('Отклик отправлен заказчику.');
  }catch(problem){setError(problem);}finally{setBusy(false);}}
  return <section className="profile-card"><p className="eyebrow">Ваше предложение</p><h2>Откликнуться на проект</h2><p className="profile-help">Предложите цену и срок выполнения. Отправка отклика не создаёт заказ.</p>
    {loading?<p role="status">Проверяем ваши отклики…</p>:pending&&!pending.expired?<ProposalCard proposal={pending} onChange={value=>{setPending(value.status==='PENDING'?value:null);setMessage('Отклик отозван. Можно отправить новое предложение.');}}/>:checked&&<form className="proposal-form" onSubmit={send}><fieldset disabled={busy}>
      <div className="field"><label htmlFor="proposal-message">Сопроводительное сообщение</label><textarea id="proposal-message" required maxLength={5000} rows={4} value={draft.message} onChange={event=>setDraft({...draft,message:event.target.value})}/></div>
      <div className="profile-fields"><div className="field"><label htmlFor="proposal-price">Предлагаемая цена (необязательно)</label><input id="proposal-price" type="number" min="0.01" max="9999999999.99" step="0.01" value={draft.offeredPrice} onChange={event=>setDraft({...draft,offeredPrice:event.target.value})}/><small>Если оставить пустой, согласованная цена будет не указана.</small></div>
      <div className="field"><label htmlFor="proposal-deadline">Предлагаемый срок</label><input id="proposal-deadline" type="datetime-local" required value={draft.offeredDeadlineAt} onChange={event=>setDraft({...draft,offeredDeadlineAt:event.target.value})}/><small>Укажите дату и время в будущем.</small></div></div>
      <button type="submit">{busy?'Отправляем…':'Отправить отклик ↗'}</button>
    </fieldset></form>}
    <ErrorMessage error={error}/>{error&&!pending&&<button className="text-button" onClick={()=>setAttempt(value=>value+1)}>Проверить состояние и продолжить</button>}<p className="save-message" role="status">{message}</p><a className="text-link" href="/me/proposals">История моих откликов ↗</a>
  </section>;
}

export function OwnProposalsPage({user}){
  if(user.role!=='CLIENT')return <section className="profile-card"><h1>Отклики доступны клиенту</h1><a className="text-link" href="/projects">Перейти в каталог</a></section>;
  return <><div className="profile-page-heading"><div><p className="eyebrow">Предложения и договорённости</p><h1>Мои отклики</h1><p className="profile-help">Следите за решениями заказчиков и возвращайтесь к согласованным условиям.</p></div><a className="button-link" href="/projects">Найти проект ↗</a></div>
    <section className="profile-card"><ProposalList path="/me/proposals"/></section></>;
}

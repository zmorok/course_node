import React,{useEffect,useState} from 'react';
import {api} from './api.js';
import {FileLink} from './PortfolioPanel.jsx';
const statuses={IN_PROGRESS:'В работе',SUBMITTED:'На проверке',REVISION_REQUESTED:'На доработке',COMPLETED:'Завершён',CANCELLED:'Отменён'};
const histories=['COMPLETED','CANCELLED'];
const active=['IN_PROGRESS','SUBMITTED','REVISION_REQUESTED'];
const price=value=>value===null?'Цена не указана':new Intl.NumberFormat('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(value));
const date=value=>value?new Date(value).toLocaleString('ru-RU',{day:'numeric',month:'long',year:'numeric',hour:'2-digit',minute:'2-digit'}):'Не указан';
const modeName=mode=>mode==='customer'?'Как заказчик':'Как исполнитель';
function ErrorMessage({error}){return error?<div className="form-error" role="alert">{error.message}{error.details?.map(issue=><small key={issue.field}>{issue.message}</small>)}</div>:null;}
function ClientOnly(){return <section className="profile-card"><h1>Заказы доступны клиенту</h1><p className="profile-help">Режим заказчика или исполнителя определяется участием в конкретном заказе.</p><a className="text-link" href="/projects">Каталог проектов</a></section>;}
function OrderBadges({order}){return <div className="project-card-top"><span className={`project-status status-${order.status.toLowerCase()}`}>{statuses[order.status]}</span><span className="order-mode">{modeName(order.participantMode)}</span>{order.isOverdue&&<span className="order-overdue">Срок истёк</span>}</div>;}
function OrderCard({order}){
  const counterpart=order.participantMode==='customer'?order.freelancer:order.customer;
  return <article className="profile-card order-card"><OrderBadges order={order}/><h2><a href={`/orders/${order.id}`}>{order.title}</a></h2><p className="order-person">{order.participantMode==='customer'?'Исполнитель':'Заказчик'}: <a className="text-link" href={`/users/${counterpart.id}`}>{counterpart.firstName} {counterpart.lastName}</a></p>
    <div className="project-card-bottom"><strong>{price(order.agreedPrice)}</strong><span>Срок: {date(order.deadlineAt)}</span><a className="text-link" href={`/orders/${order.id}`}>Открыть заказ ↗</a></div>
    {order.completedAt&&<p className="order-closed">Завершён: {date(order.completedAt)}</p>}{order.cancelledAt&&<p className="order-closed">Отменён: {date(order.cancelledAt)}</p>}
  </article>;
}
export function OrderListPage({user}){
  const query=window.location.search,params=new URLSearchParams(query),mode=params.get('mode')??'customer',scope=params.get('scope')??'active',filtered=Boolean(params.get('status'));
  const [data,setData]=useState(null),[loading,setLoading]=useState(true),[error,setError]=useState(null),[attempt,setAttempt]=useState(0),[status,setStatus]=useState(params.get('status')??'');
  useEffect(()=>{if(user.role!=='CLIENT')return;let mounted=true;setLoading(true);setData(null);setError(null);api(`/me/orders${query}`).then(result=>{if(mounted)setData(result);}).catch(problem=>{if(mounted)setError(problem);}).finally(()=>{if(mounted)setLoading(false);});return()=>{mounted=false;};},[query,user.id,user.role,attempt]);
  if(user.role!=='CLIENT')return <ClientOnly/>;
  function listUrl(nextMode=mode,nextScope=scope,page=1,nextStatus=params.get('status')??''){const next=new URLSearchParams({mode:nextMode,scope:nextScope});if(nextStatus)next.set('status',nextStatus);if(page>1)next.set('page',page);if(params.has('pageSize'))next.set('pageSize',params.get('pageSize'));return `/me/orders?${next}`;}
  return <><div className="profile-page-heading"><div><p className="eyebrow">Согласованная работа</p><h1>Заказы</h1><p className="profile-help">Работа в процессе и история договорённостей — в двух режимах одного аккаунта.</p></div><a className="text-link" href="/projects">Каталог проектов ↗</a></div>
    <section className="profile-card order-controls"><nav className="order-switch" aria-label="Ваше участие в заказе"><a href={listUrl('customer',scope)} aria-current={mode==='customer'?'page':undefined}>Как заказчик</a><a href={listUrl('freelancer',scope)} aria-current={mode==='freelancer'?'page':undefined}>Как исполнитель</a></nav>
      <nav className="invitation-tabs" aria-label="Состояние заказов"><a href={listUrl(mode,'active',1,'')} aria-current={scope==='active'?'page':undefined}>Активные</a><a href={listUrl(mode,'history',1,'')} aria-current={scope==='history'?'page':undefined}>История</a></nav>
      <div className="order-toolbar"><form onSubmit={event=>{event.preventDefault();window.location.assign(listUrl(mode,scope,1,status));}}><div className="field"><label htmlFor="order-status">Статус заказа</label><select id="order-status" value={status} onChange={event=>setStatus(event.target.value)}><option value="">Все статусы</option>{(scope==='history'?histories:active).map(value=><option key={value} value={value}>{statuses[value]}</option>)}</select></div><button className="secondary" type="submit">Применить</button></form><button className="text-button" disabled={loading} onClick={()=>setAttempt(value=>value+1)}>Обновить заказы</button></div>
    </section>
    <section className="project-results" aria-label={scope==='history'?'История заказов':'Активные заказы'}>{loading?<div className="profile-card" role="status">Загружаем заказы…</div>:error?<div className="profile-card"><ErrorMessage error={error}/><button className="secondary" onClick={()=>setAttempt(value=>value+1)}>Повторить загрузку</button><a className="text-link" href="/me/orders">К списку заказов</a></div>:<>
      <p className="project-result-count" role="status">Найдено заказов: {data.total}</p>{data.items.map(order=><OrderCard key={order.id} order={order}/>)}
      {!data.items.length&&<div className="profile-card project-empty"><h2>{data.total?'На этой странице заказов нет':filtered?'Заказов с таким статусом нет':scope==='history'?'История пока пуста':'Активных заказов пока нет'}</h2><p className="profile-help">{data.total?'Вернитесь на предыдущую страницу.':filtered?'Выберите другой статус или покажите все заказы этого раздела.':scope==='history'?'Здесь сохраняются завершённые и отменённые заказы.':mode==='customer'?'Выберите исполнителя через отклик или приглашение, чтобы начать работу.':'Заказ появится после принятия вашего отклика или приглашения заказчика.'}</p><a className="text-link" href={data.total?listUrl(mode,scope):filtered?listUrl(mode,scope,1,''):mode==='customer'?'/me/projects':'/projects'}>{data.total?'Первая страница':filtered?'Показать все заказы':'Перейти к проектам ↗'}</a></div>}
      {data.total>0&&<nav className="project-pagination" aria-label="Страницы заказов">{data.page>1&&<a href={listUrl(mode,scope,data.page-1)}>← Назад</a>}<span>Страница {data.page} из {Math.ceil(data.total/data.pageSize)}</span>{data.page*data.pageSize<data.total&&<a href={listUrl(mode,scope,data.page+1)}>Далее →</a>}</nav>}
    </>}</section></>;
}

export function OrderDetailsPage({orderId,user}){
  const [order,setOrder]=useState(null),[loading,setLoading]=useState(true),[error,setError]=useState(null),[attempt,setAttempt]=useState(0);
  useEffect(()=>{if(user.role!=='CLIENT')return;let mounted=true;setOrder(null);setLoading(true);setError(null);api(`/orders/${encodeURIComponent(orderId)}`).then(result=>{if(mounted)setOrder(result.order);}).catch(problem=>{if(mounted)setError(problem);}).finally(()=>{if(mounted)setLoading(false);});return()=>{mounted=false;};},[orderId,user.id,user.role,attempt]);
  if(user.role!=='CLIENT')return <ClientOnly/>;
  if(loading)return <div className="profile-card" role="status">Загружаем заказ…</div>;
  if(!order)return <section className="profile-card"><h1>Не удалось открыть заказ</h1><ErrorMessage error={error}/>{error?.status!==404&&<button className="secondary" onClick={()=>setAttempt(value=>value+1)}>Повторить</button>}<a className="text-link" href="/me/orders">К своим заказам</a></section>;
  const messages={IN_PROGRESS:'Исполнитель выполняет согласованное задание.',SUBMITTED:'Результат передан заказчику на проверку.',REVISION_REQUESTED:'Результат возвращён исполнителю на доработку.',COMPLETED:'Заказчик принял работу. Соглашение сохранено в истории.',CANCELLED:'Работа по заказу прекращена. Согласованные условия сохранены в истории.'};
  const back=`/me/orders?mode=${order.participantMode}&scope=${histories.includes(order.status)?'history':'active'}`;
  return <><div className="profile-page-heading"><div><p className="eyebrow">{order.source.type==='proposal'?'Заказ по принятому отклику':'Заказ по принятому приглашению'}</p><h1 className="project-title">{order.title}</h1><OrderBadges order={order}/></div><a className="text-link" href={back}>← К своим заказам</a></div>
    <div className="project-detail-layout"><div className="profile-editor"><section className="profile-card"><h2>Согласованное задание</h2><p className="public-description">{order.description}</p><p className="profile-help">Описание и вложения зафиксированы при создании заказа.</p></section>
      <section className="profile-card"><h2>Файлы задания</h2>{order.files.length?<div className="attachment-list">{order.files.map(file=><FileLink key={file.id} file={file} privateFile/>)}</div>:<p className="profile-help">Вложений нет.</p>}</section>
      <section className="profile-card"><h2>Состояние работы</h2><p className="public-description">{messages[order.status]}</p>{order.isOverdue&&<p className="order-overdue-note">Согласованный срок истёк. Заказ остаётся активным.</p>}
        {order.lastSubmission&&<p className="profile-help">Последняя версия результата: {order.lastSubmission.version}. Передана {date(order.lastSubmission.createdAt)}.</p>}
        {order.pendingDeadlineRequest&&<p className="profile-help">{order.pendingDeadlineRequest.isCurrent?'Есть запрос изменения срока до':'Прежний запрос изменения срока больше не актуален. Предлагалась дата'} {date(order.pendingDeadlineRequest.proposedDeadlineAt)}.</p>}
      </section>
      {order.cancellationReason&&<section className="profile-card"><h2>Причина отмены</h2><p className="public-description">{order.cancellationReason}</p><p className="profile-help">{order.cancelledBy===order.customer.id?'Отменил заказчик':'Отказался исполнитель'} · {date(order.cancelledAt)}</p></section>}
    </div><aside className="profile-card project-summary"><p className="eyebrow">Условия и участники</p><p className="project-budget">{price(order.agreedPrice)}</p><dl><dt>Текущий срок</dt><dd>{date(order.deadlineAt)}</dd><dt>Первоначальный срок</dt><dd>{date(order.initialDeadlineAt)}</dd><dt>Заказчик</dt><dd><a className="text-link" href={`/users/${order.customer.id}`}>{order.customer.firstName} {order.customer.lastName}</a></dd><dt>Исполнитель</dt><dd><a className="text-link" href={`/users/${order.freelancer.id}`}>{order.freelancer.firstName} {order.freelancer.lastName}</a></dd><dt>Создан</dt><dd>{date(order.createdAt)}</dd>{order.completedAt&&<><dt>Завершён</dt><dd>{date(order.completedAt)}</dd></>}</dl>
      <div className="project-owner-actions"><button className="secondary" onClick={()=>setAttempt(value=>value+1)}>Обновить заказ ↻</button>{(order.participantMode==='customer'||order.project.status==='OPEN')&&<a className="text-link" href={`/projects/${order.project.id}`}>Карточка проекта ↗</a>}</div>
    </aside></div></>;
}

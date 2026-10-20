import { navigate, getLocation } from './navigation.js';
import { Link } from './Navigation.jsx';
import { t, locale } from "./i18n.js";import { Pagination, ErrorMessage, StatusBadge } from './Ui.jsx';
import React, { useEffect, useState } from 'react';
import { api } from './api.js';
import { FileLink } from './PortfolioPanel.jsx';
import { OrderWorkPanel } from './OrderWorkPanel.jsx';
import { OrderHistoryPanel } from './OrderHistoryPanel.jsx';
import { OrderReviews } from './Reviews.jsx';
import { OrderComplaint } from './Complaints.jsx';
const statuses = () => ({ IN_PROGRESS: t("В работе"), SUBMITTED: t("На проверке"), REVISION_REQUESTED: t("На доработке"), COMPLETED: t("Завершён"), CANCELLED: t("Отменён") });
const histories = ['COMPLETED', 'CANCELLED'];
const active = ['IN_PROGRESS', 'SUBMITTED', 'REVISION_REQUESTED'];
const price = (value) => value === null ? t("Цена не указана") : new Intl.NumberFormat(locale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value));
const date = (value) => value ? new Date(value).toLocaleString(locale(), { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : t("Не указан");
const modeName = (mode) => mode === 'customer' ? t("Как заказчик") : t("Как исполнитель");
function ClientOnly() {return <section className="profile-card"><h1>{t("Заказы доступны клиенту")}</h1><p className="profile-help">{t("Режим заказчика или исполнителя определяется участием в конкретном заказе.")}</p><Link className="text-link" href="/projects">{t("Каталог проектов")}</Link></section>;}
function OrderBadges({ order }) {return <div className="project-card-top"><StatusBadge status={order.status} labels={statuses()} /><span className="order-mode">{modeName(order.participantMode)}</span>{order.isOverdue && <span className="order-overdue">{t("Срок истёк")}</span>}</div>;}
function OrderCard({ order }) {
  const counterpart = order.participantMode === 'customer' ? order.freelancer : order.customer;
  return <article className="profile-card order-card"><OrderBadges order={order} /><h2><Link href={`/orders/${order.id}`}>{order.title}</Link></h2><p className="order-person">{order.participantMode === 'customer' ? t("Исполнитель") : t("Заказчик")}: <Link className="text-link" href={`/users/${counterpart.id}`}>{counterpart.firstName} {counterpart.lastName}</Link></p>
    <div className="project-card-bottom"><strong>{price(order.agreedPrice)}</strong><span>{t("Срок: ")}{date(order.deadlineAt)}</span><Link className="text-link" href={`/orders/${order.id}`}>{t("Открыть заказ ↗")}</Link></div>
    {order.completedAt && <p className="order-closed">{t("Завершён: ")}{date(order.completedAt)}</p>}{order.cancelledAt && <p className="order-closed">{t("Отменён: ")}{date(order.cancelledAt)}</p>}
  </article>;
}
export function OrderListPage({ user }) {
  const query = getLocation().search,params = new URLSearchParams(query),mode = params.get('mode') ?? 'customer',scope = params.get('scope') ?? 'active',filtered = Boolean(params.get('status'));
  const [data, setData] = useState(null),[loading, setLoading] = useState(true),[error, setError] = useState(null),[attempt, setAttempt] = useState(0),[status, setStatus] = useState(params.get('status') ?? '');
  useEffect(() => {if (user.role !== 'CLIENT') return;let mounted = true;setLoading(true);setData(null);setError(null);api(`/me/orders${query}`).then((result) => {if (mounted) setData(result);}).catch((problem) => {if (mounted) setError(problem);}).finally(() => {if (mounted) setLoading(false);});return () => {mounted = false;};}, [query, user.id, user.role, attempt]);
  if (user.role !== 'CLIENT') return <ClientOnly />;
  function listUrl(nextMode = mode, nextScope = scope, page = 1, nextStatus = params.get('status') ?? '') {const next = new URLSearchParams({ mode: nextMode, scope: nextScope });if (nextStatus) next.set('status', nextStatus);if (page > 1) next.set('page', page);if (params.has('pageSize')) next.set('pageSize', params.get('pageSize'));return `/me/orders?${next}`;}
  return <><div className="profile-page-heading"><div><p className="eyebrow">{t("Согласованная работа")}</p><h1>{t("Заказы")}</h1><p className="profile-help">{t("Работа в процессе и история договорённостей — в двух режимах одного аккаунта.")}</p></div><Link className="text-link" href="/projects">{t("Каталог проектов ↗")}</Link></div>
    <section className="profile-card order-controls"><nav className="order-switch" aria-label={t("Ваше участие в заказе")}><Link href={listUrl('customer', scope)} aria-current={mode === 'customer' ? 'page' : undefined}>{t("Как заказчик")}</Link><Link href={listUrl('freelancer', scope)} aria-current={mode === 'freelancer' ? 'page' : undefined}>{t("Как исполнитель")}</Link></nav>
      <nav className="invitation-tabs" aria-label={t("Состояние заказов")}><Link href={listUrl(mode, 'active', 1, '')} aria-current={scope === 'active' ? 'page' : undefined}>{t("Активные")}</Link><Link href={listUrl(mode, 'history', 1, '')} aria-current={scope === 'history' ? 'page' : undefined}>{t("История")}</Link></nav>
      <div className="order-toolbar"><form onSubmit={(event) => {event.preventDefault();navigate(listUrl(mode, scope, 1, status));}}><div className="field"><label htmlFor="order-status">{t("Статус заказа")}</label><select id="order-status" value={status} onChange={(event) => setStatus(event.target.value)}><option value="">{t("Все статусы")}</option>{(scope === 'history' ? histories : active).map((value) => <option key={value} value={value}>{statuses()[value]}</option>)}</select></div><button className="secondary" type="submit">{t("Применить")}</button></form><button className="text-button" disabled={loading} onClick={() => setAttempt((value) => value + 1)}>{t("Обновить заказы")}</button></div>
    </section>
    <section className="project-results" aria-label={scope === 'history' ? t("История заказов") : t("Активные заказы")}>{loading ? <div className="profile-card" role="status">{t("Загружаем заказы…")}</div> : error ? <div className="profile-card"><ErrorMessage error={error} /><button className="secondary" onClick={() => setAttempt((value) => value + 1)}>{t("Повторить загрузку")}</button><Link className="text-link" href="/me/orders">{t("К списку заказов")}</Link></div> : <>
      <p className="project-result-count" role="status">{t("Найдено заказов: ")}{data.total}</p>{data.items.map((order) => <OrderCard key={order.id} order={order} />)}
      {!data.items.length && <div className="profile-card project-empty"><h2>{data.total ? t("На этой странице заказов нет") : filtered ? t("Заказов с таким статусом нет") : scope === 'history' ? t("История пока пуста") : t("Активных заказов пока нет")}</h2><p className="profile-help">{data.total ? t("Вернитесь на предыдущую страницу.") : filtered ? t("Выберите другой статус или покажите все заказы этого раздела.") : scope === 'history' ? t("Здесь сохраняются завершённые и отменённые заказы.") : mode === 'customer' ? t("Выберите исполнителя через отклик или приглашение, чтобы начать работу.") : t("Заказ появится после принятия вашего отклика или приглашения заказчика.")}</p><Link className="text-link" href={data.total ? listUrl(mode, scope) : filtered ? listUrl(mode, scope, 1, '') : mode === 'customer' ? '/me/projects' : '/projects'}>{data.total ? t("Первая страница") : filtered ? t("Показать все заказы") : t("Перейти к проектам ↗")}</Link></div>}
      <Pagination data={data} href={(page) => listUrl(mode, scope, page)} label={t("Страницы заказов")} />
    </>}</section></>;
}

export function OrderDetailsPage({ orderId, user }) {
  const [order, setOrder] = useState(null),[loading, setLoading] = useState(true),[error, setError] = useState(null),[attempt, setAttempt] = useState(0);
  useEffect(() => {if (user.role !== 'CLIENT') return;let mounted = true;setOrder(null);setLoading(true);setError(null);api(`/orders/${encodeURIComponent(orderId)}`).then((result) => {if (mounted) setOrder(result.order);}).catch((problem) => {if (mounted) setError(problem);}).finally(() => {if (mounted) setLoading(false);});return () => {mounted = false;};}, [orderId, user.id, user.role, attempt]);
  if (user.role !== 'CLIENT') return <ClientOnly />;
  if (loading) return <div className="profile-card" role="status">{t("Загружаем заказ…")}</div>;
  if (!order) return <section className="profile-card"><h1>{t("Не удалось открыть заказ")}</h1><ErrorMessage error={error} />{error?.status !== 404 && <button className="secondary" onClick={() => setAttempt((value) => value + 1)}>{t("Повторить")}</button>}<Link className="text-link" href="/me/orders">{t("К своим заказам")}</Link></section>;
  const messages = { IN_PROGRESS: t("Исполнитель выполняет согласованное задание."), SUBMITTED: t("Результат передан заказчику на проверку."), REVISION_REQUESTED: t("Результат возвращён исполнителю на доработку."), COMPLETED: t("Заказчик принял работу. Соглашение сохранено в истории."), CANCELLED: t("Работа по заказу прекращена. Согласованные условия сохранены в истории.") };
  const back = `/me/orders?mode=${order.participantMode}&scope=${histories.includes(order.status) ? 'history' : 'active'}`;
  async function refreshWork() {const result = await api(`/orders/${encodeURIComponent(orderId)}`);setOrder(result.order);}
  return <><div className="profile-page-heading"><div><p className="eyebrow">{order.source.type === 'proposal' ? t("Заказ по принятому отклику") : t("Заказ по принятому приглашению")}</p><h1 className="project-title">{order.title}</h1><OrderBadges order={order} /></div><Link className="text-link" href={back}>{t("← К своим заказам")}</Link></div>
    <div className="project-detail-layout"><div className="profile-editor"><section className="profile-card"><h2>{t("Согласованное задание")}</h2><p className="public-description">{order.description}</p><p className="profile-help">{t("Описание и вложения зафиксированы при создании заказа.")}</p></section>
      <section className="profile-card"><h2>{t("Файлы задания")}</h2>{order.files.length ? <div className="attachment-list">{order.files.map((file) => <FileLink key={file.id} file={file} privateFile />)}</div> : <p className="profile-help">{t("Вложений нет.")}</p>}</section>
      <section className="profile-card"><h2>{t("Состояние работы")}</h2><p className="public-description">{messages[order.status]}</p>{order.isOverdue && <p className="order-overdue-note">{t("Согласованный срок истёк. Заказ остаётся активным.")}</p>}
        {order.lastSubmission && <p className="profile-help">{t("Последняя версия результата: ")}{order.lastSubmission.version}{t(". Передана ")}{date(order.lastSubmission.createdAt)}.</p>}
        {order.pendingDeadlineRequest && <p className="profile-help">{order.pendingDeadlineRequest.isCurrent ? t("Есть запрос изменения срока до") : t("Прежний запрос изменения срока больше не актуален. Предлагалась дата")} {date(order.pendingDeadlineRequest.proposedDeadlineAt)}.</p>}
      </section>
      {order.cancellationReason && <section className="profile-card"><h2>{t("Причина отмены")}</h2><p className="public-description">{order.cancellationReason}</p><p className="profile-help">{order.cancelledBy === order.customer.id ? t("Отменил заказчик") : t("Отказался исполнитель")} · {date(order.cancelledAt)}</p></section>}
      <OrderWorkPanel key={order.id} order={order} onChange={refreshWork} />
      <OrderHistoryPanel key={`history-${order.id}`} order={order} onChange={refreshWork} />
      <OrderReviews key={`reviews-${order.id}`} order={order} />
      <OrderComplaint key={`complaint-${order.id}`} order={order} />
    </div><aside className="profile-card project-summary"><p className="eyebrow">{t("Условия и участники")}</p><p className="project-budget">{price(order.agreedPrice)}</p><dl><dt>{t("Текущий срок")}</dt><dd>{date(order.deadlineAt)}</dd><dt>{t("Первоначальный срок")}</dt><dd>{date(order.initialDeadlineAt)}</dd><dt>{t("Заказчик")}</dt><dd><Link className="text-link" href={`/users/${order.customer.id}`}>{order.customer.firstName} {order.customer.lastName}</Link></dd><dt>{t("Исполнитель")}</dt><dd><Link className="text-link" href={`/users/${order.freelancer.id}`}>{order.freelancer.firstName} {order.freelancer.lastName}</Link></dd><dt>{t("Создан")}</dt><dd>{date(order.createdAt)}</dd>{order.completedAt && <><dt>{t("Завершён")}</dt><dd>{date(order.completedAt)}</dd></>}</dl>
      <div className="project-owner-actions"><button className="secondary" onClick={() => setAttempt((value) => value + 1)}>{t("Обновить заказ ↻")}</button>{(order.participantMode === 'customer' || order.project.status === 'OPEN') && <Link className="text-link" href={`/projects/${order.project.id}`}>{t("Карточка проекта ↗")}</Link>}</div>
    </aside></div></>;
}

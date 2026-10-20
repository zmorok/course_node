import { Link } from './Navigation.jsx';
import { t, locale } from "./i18n.js";import { ErrorMessage } from './Ui.jsx';
import React, { useEffect, useState } from 'react';
import { api } from './api.js';
import { FileLink } from './PortfolioPanel.jsx';

const statuses = { PENDING: t("Ожидает решения"), ACCEPTED: t("Принят"), REJECTED: t("Отклонён"), WITHDRAWN: t("Отозван") };
const reasons = { AUTHOR_WITHDRAWN: t("Отозван исполнителем"), CUSTOMER_REJECTED: t("Отклонён заказчиком"), TERMS_CHANGED: t("Условия проекта изменились"), PROJECT_CANCELLED: t("Проект отменён"), OTHER_SOURCE_ACCEPTED: t("Выбран другой исполнитель"), TERMS_EXPIRED: t("Предложенный срок истёк") };
const price = (value) => value === null ? t("Не указана") : new Intl.NumberFormat(locale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value));
const date = (value) => new Date(value).toLocaleString(locale(), { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export function Agreement({ order }) {
  return <section className="proposal-agreement" aria-label={t("Согласованные условия заказа")}><p className="eyebrow">{{ IN_PROGRESS: t("Заказ в работе"), SUBMITTED: t("Результат на проверке"), REVISION_REQUESTED: t("Ожидается доработка"), COMPLETED: t("Заказ завершён"), CANCELLED: t("Заказ отменён") }[order.status]}</p><h3>{order.title}</h3>
    <p className="profile-help">{t("Условия и вложения зафиксированы при создании заказа.")}</p><dl className="proposal-terms"><div><dt>{t("Согласованная цена")}</dt><dd>{price(order.agreedPrice)}</dd></div><div><dt>{t("Согласованный срок")}</dt><dd>{date(order.initialDeadlineAt)}</dd></div></dl>
    <details><summary>{t("Описание и файлы задания")}</summary><p className="public-description">{order.description}</p>{order.files.length ? <div className="attachment-list">{order.files.map((file) => <FileLink key={file.id} file={file} privateFile />)}</div> : <p className="profile-help">{t("Вложений нет.")}</p>}</details>
    <Link className="text-link order-agreement-link" href={`/orders/${order.id}`}>{t("Открыть заказ ↗")}</Link>
  </section>;
}
function ProposalCard({ proposal, onChange }) {
  const [action, setAction] = useState(null),[reason, setReason] = useState(''),[busy, setBusy] = useState(false),[error, setError] = useState(null);
  async function decide(event) {event.preventDefault();setBusy(true);setError(null);try {
      const result = await api(`/proposals/${proposal.id}/${action}`, { method: 'POST', body: action === 'reject' && reason.trim() ? { reason } : {} });
      setAction(null);setReason('');onChange(result.proposal);
    } catch (problem) {setError(problem);} finally {setBusy(false);}}
  const choose = (kind) => {setAction(kind);setError(null);};
  return <article className="proposal-card">
    <div className="project-card-top"><span className={`project-status status-${proposal.status.toLowerCase()}`}>{proposal.expired ? t("Срок истёк") : statuses[proposal.status]}</span><span className="proposal-created">{date(proposal.createdAt)}</span></div>
    <h3>{proposal.project.status === 'OPEN' ? <Link className="text-link" href={`/projects/${proposal.project.id}`}>{proposal.project.title}</Link> : proposal.project.title}</h3>
    <p className="proposal-parties"><Link href={`/users/${proposal.freelancer.id}`}>{proposal.freelancer.firstName} {proposal.freelancer.lastName}</Link><span> → </span><Link href={`/users/${proposal.customer.id}`}>{proposal.customer.firstName} {proposal.customer.lastName}</Link></p>
    <p className="public-description">{proposal.message}</p><dl className="proposal-terms"><div><dt>{t("Предложенная цена")}</dt><dd>{price(proposal.offeredPrice)}</dd></div><div><dt>{t("Предложенный срок")}</dt><dd>{date(proposal.offeredDeadlineAt)}</dd></div></dl>
    {proposal.closureReason && <p className="proposal-reason">{reasons[proposal.closureReason] ?? proposal.closureReason}</p>}
    {proposal.expired && <p className="profile-help">{t("Этот отклик уже нельзя принять. Исполнитель может отправить новый с актуальным сроком.")}</p>}
    {proposal.order && <Agreement order={proposal.order} />}
    {!action && <div className="proposal-actions">{proposal.canDecide && <><button disabled={busy} onClick={() => choose('accept')}>{t("Принять отклик ↗")}</button><button className="secondary" disabled={busy} onClick={() => choose('reject')}>{t("Отклонить")}</button></>}{proposal.canWithdraw && <button className="text-button" disabled={busy} onClick={() => choose('withdraw')}>{t("Отозвать отклик")}</button>}</div>}
    {action && <form className="proposal-confirm" onSubmit={decide}><fieldset disabled={busy}>
      {action === 'accept' ? <><h4>{t("Принять предложение?")}</h4><p>{t("Исполнитель: ")}{proposal.freelancer.firstName} {proposal.freelancer.lastName}{t(". Цена: ")}{price(proposal.offeredPrice)}{t(". Срок: ")}{date(proposal.offeredDeadlineAt)}.</p><p>{t("Будет создан заказ, проект перейдёт в работу, остальные ожидающие предложения закроются.")}</p></> :
        action === 'withdraw' ? <p>{t("Отозвать предложение? Оно останется в истории, и вы сможете откликнуться снова.")}</p> : <div className="field"><label htmlFor={`reject-${proposal.id}`}>{t("Причина отклонения (необязательно)")}</label><textarea id={`reject-${proposal.id}`} rows={3} maxLength={1000} value={reason} onChange={(event) => setReason(event.target.value)} /></div>}
      <div className="proposal-actions"><button type="submit">{busy ? t("Сохраняем…") : action === 'accept' ? t("Подтвердить и создать заказ") : action === 'reject' ? t("Подтвердить отклонение") : t("Подтвердить отзыв")}</button><button type="button" className="secondary" onClick={() => setAction(null)}>{t("Назад")}</button></div>
    </fieldset></form>}<ErrorMessage error={error} />
  </article>;
}

function ProposalList({ path, onChange, pendingOnly = false, revision }) {
  const [status, setStatus] = useState(pendingOnly ? 'PENDING' : ''),[page, setPage] = useState(1),[attempt, setAttempt] = useState(0),[data, setData] = useState(null),[loading, setLoading] = useState(true),[error, setError] = useState(null),[completed, setCompleted] = useState(null);
  useEffect(() => {let active = true;setLoading(true);setError(null);const params = new URLSearchParams(path.includes('?') ? path.split('?')[1] : '');params.set('page', page);if (status) params.set('status', status);
    api(`${path.split('?')[0]}?${params}`).then((result) => {if (active) setData(result);}).catch((problem) => {if (active) setError(problem);}).finally(() => {if (active) setLoading(false);});return () => {active = false;};
  }, [path, status, page, attempt, revision]);
  function changed(proposal) {setCompleted(proposal);setAttempt((value) => value + 1);onChange?.(proposal);}
  return <div className="proposal-list">
    {!pendingOnly && <div className="proposal-toolbar"><div className="field"><label htmlFor="proposal-status">{t("Статус откликов")}</label><select id="proposal-status" value={status} onChange={(event) => {setStatus(event.target.value);setPage(1);}}><option value="">{t("Все статусы")}</option>{Object.entries(statuses).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div><button className="text-button" disabled={loading} onClick={() => setAttempt((value) => value + 1)}>{t("Обновить список")}</button></div>}
    {completed && <p className="save-message" role="status">{completed.order ? t("Отклик принят. Заказ создан, проект в работе.") : completed.status === 'WITHDRAWN' ? t("Отклик отозван.") : t("Отклик отклонён.")}</p>}
    {completed?.order && (loading || !data?.items.some((item) => item.id === completed.id)) && <Agreement order={completed.order} />}
    {loading ? <p role="status">{t("Загружаем отклики…")}</p> : error ? <><ErrorMessage error={error} /><button className="secondary" onClick={() => setAttempt((value) => value + 1)}>{t("Повторить загрузку")}</button></> : <>
      {!data.items.length && <p className="portfolio-empty">{data.total ? t("На этой странице откликов нет. Вернитесь назад.") : pendingOnly ? t("Ожидающих откликов нет.") : t("Откликов пока нет. Здесь появятся предложения и история решений.")}</p>}
      {data.items.map((proposal) => <ProposalCard key={proposal.id} proposal={proposal} onChange={changed} />)}
      {data.total > 0 && <nav className="project-pagination" aria-label={t("Страницы откликов")}>{page > 1 && <button className="text-button" onClick={() => setPage(page - 1)}>{t("← Назад")}</button>}<span>{t("Страница ")}{data.page}{t(" из ")}{Math.ceil(data.total / data.pageSize)}</span>{page * data.pageSize < data.total && <button className="text-button" onClick={() => setPage(page + 1)}>{t("Далее →")}</button>}</nav>}
    </>}
  </div>;
}

export function ProjectProposals({ project, user, onProjectChange }) {
  const [pending, setPending] = useState(null),[loading, setLoading] = useState(true),[checked, setChecked] = useState(false),[error, setError] = useState(null),[attempt, setAttempt] = useState(0),[busy, setBusy] = useState(false),[message, setMessage] = useState('');
  const [draft, setDraft] = useState({ message: '', offeredPrice: '', offeredDeadlineAt: '' });
  const eligible = user?.role === 'CLIENT' && !project.isOwn && project.status === 'OPEN';
  useEffect(() => {if (!eligible) return;let active = true;setLoading(true);setChecked(false);setError(null);api(`/me/proposals?projectId=${project.id}&status=PENDING&pageSize=1`).then((data) => {if (active) {setPending(data.items[0] ?? null);setChecked(true);}}).
    catch((problem) => {if (active) setError(problem);}).finally(() => {if (active) setLoading(false);});return () => {active = false;};}, [project.id, user?.id, eligible, attempt]);
  if (project.isOwn && user?.role === 'CLIENT') return <section className="profile-card"><p className="eyebrow">{project.status === 'OPEN' ? t("Выберите исполнителя") : t("История предложений")}</p><h2>{t("Отклики на проект")}</h2><p className="profile-help">{project.status === 'OPEN' ? t("Примите подходящее предложение, чтобы зафиксировать условия и начать работу.") : t("Предложения, принятые решения и зафиксированные условия заказа.")}</p><ProposalList path={`/projects/${project.id}/proposals`} revision={project.status} onChange={(proposal) => {if (proposal.order) onProjectChange();}} /></section>;
  if (!user && project.status === 'OPEN') return <section className="profile-card"><h2>{t("Готовы взяться за проект?")}</h2><p className="profile-help">{t("Войдите в аккаунт, чтобы предложить свои условия.")}</p><Link className="text-link" href="/">{t("Войти или зарегистрироваться ↗")}</Link></section>;
  if (!eligible) return null;
  async function send(event) {event.preventDefault();if (!Number.isFinite(new Date(draft.offeredDeadlineAt).getTime())) {setError({ message: t("Укажите дату и время выполнения.") });return;}setBusy(true);setError(null);setMessage('');try {
      const result = await api(`/projects/${project.id}/proposals`, { method: 'POST', body: { message: draft.message, offeredPrice: draft.offeredPrice || null, offeredDeadlineAt: new Date(draft.offeredDeadlineAt).toISOString() } });
      setPending(result.proposal);setDraft({ message: '', offeredPrice: '', offeredDeadlineAt: '' });setMessage(t("Отклик отправлен заказчику."));
    } catch (problem) {setError(problem);} finally {setBusy(false);}}
  return <section className="profile-card"><p className="eyebrow">{t("Ваше предложение")}</p><h2>{t("Откликнуться на проект")}</h2><p className="profile-help">{t("Предложите цену и срок выполнения. Отправка отклика не создаёт заказ.")}</p>
    {loading ? <p role="status">{t("Проверяем ваши отклики…")}</p> : pending && !pending.expired ? <ProposalCard proposal={pending} onChange={(value) => {setPending(value.status === 'PENDING' ? value : null);setMessage(t("Отклик отозван. Можно отправить новое предложение."));}} /> : checked && <form className="proposal-form" onSubmit={send}><fieldset disabled={busy}>
      <div className="field"><label htmlFor="proposal-message">{t("Сопроводительное сообщение")}</label><textarea id="proposal-message" required maxLength={5000} rows={4} value={draft.message} onChange={(event) => setDraft({ ...draft, message: event.target.value })} /></div>
      <div className="profile-fields"><div className="field"><label htmlFor="proposal-price">{t("Предлагаемая цена (необязательно)")}</label><input id="proposal-price" type="number" min="0.01" max="9999999999.99" step="0.01" value={draft.offeredPrice} onChange={(event) => setDraft({ ...draft, offeredPrice: event.target.value })} /><small>{t("Если оставить пустой, согласованная цена будет не указана.")}</small></div>
      <div className="field"><label htmlFor="proposal-deadline">{t("Предлагаемый срок")}</label><input id="proposal-deadline" type="datetime-local" required value={draft.offeredDeadlineAt} onChange={(event) => setDraft({ ...draft, offeredDeadlineAt: event.target.value })} /><small>{t("Укажите дату и время в будущем.")}</small></div></div>
      <button type="submit">{busy ? t("Отправляем…") : t("Отправить отклик ↗")}</button>
    </fieldset></form>}
    <ErrorMessage error={error} />{error && !pending && <button className="text-button" onClick={() => setAttempt((value) => value + 1)}>{t("Проверить состояние и продолжить")}</button>}<p className="save-message" role="status">{message}</p><Link className="text-link" href="/me/proposals">{t("История моих откликов ↗")}</Link>
  </section>;
}

export function OwnProposalsPage({ user }) {
  if (user.role !== 'CLIENT') return <section className="profile-card"><h1>{t("Отклики доступны клиенту")}</h1><Link className="text-link" href="/projects">{t("Перейти в каталог")}</Link></section>;
  return <><div className="profile-page-heading"><div><p className="eyebrow">{t("Предложения и договорённости")}</p><h1>{t("Мои отклики")}</h1><p className="profile-help">{t("Следите за решениями заказчиков и возвращайтесь к согласованным условиям.")}</p></div><Link className="button-link" href="/projects">{t("Найти проект ↗")}</Link></div>
    <section className="profile-card"><ProposalList path="/me/proposals" /></section></>;
}

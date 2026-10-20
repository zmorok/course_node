import { t, locale } from "./i18n.js";import { Pagination, ErrorMessage, StatusBadge } from './Ui.jsx';
import React, { useEffect, useState } from 'react';
import { api } from './api.js';
import { uploadFile } from './files.js';
import { FileLink } from './PortfolioPanel.jsx';
import { ProjectProposals } from './ProposalPages.jsx';
import { InvitationList } from './InvitationPages.jsx';

const statuses = { DRAFT: t("Черновик"), OPEN: t("Открыт"), IN_PROGRESS: t("В работе"), COMPLETED: t("Завершён"), CANCELLED: t("Отменён") };
const money = (value) => value === null ? t("Бюджет не указан") : new Intl.NumberFormat(locale(), { maximumFractionDigits: 2 }).format(Number(value));
const date = (value) => value ? new Date(value).toLocaleDateString(locale(), { day: 'numeric', month: 'long', year: 'numeric' }) : t("Не указан");
function AccessDenied() {return <section className="profile-card"><h1>{t("Раздел доступен клиенту")}</h1><a className="text-link" href="/projects">{t("Перейти в каталог")}</a></section>;}
function Badge({ status }) {return <StatusBadge status={status} labels={statuses} />;}
function Tags({ skills }) {return <div className="profile-tags">{skills.map((skill) => <span key={skill.id}>{skill.name}</span>)}</div>;}
function ProjectCard({ project }) {return <article className="profile-card project-card">
  <div className="project-card-top"><span className="project-category">{t(project.category?.name) ?? t("Категория не выбрана")}</span><Badge status={project.status} />{project.isOwn && <span className="project-own">{t("Ваш проект")}</span>}</div>
  <h2><a href={`/projects/${project.id}`}>{project.title}</a></h2><p className="project-excerpt">{project.description.slice(0, 200) || t("Описание пока не добавлено.")}</p>
  <Tags skills={project.skills} /><div className="project-card-bottom"><strong>{money(project.budget)}</strong><span>{t("Срок: ")}{date(project.desiredDeadlineAt)}</span><a className="text-link" href={`/projects/${project.id}`}>{t("Подробнее ↗")}</a></div>
</article>;}

export function ProjectListPage({ user, mine = false }) {
  const path = mine ? '/me/projects' : '/projects',query = window.location.search;
  const initial = Object.fromEntries(new URLSearchParams(query));
  const [filters, setFilters] = useState({ search: initial.search ?? '', category: initial.category ?? '', skill: initial.skill ?? '', minBudget: initial.minBudget ?? '', maxBudget: initial.maxBudget ?? '', sort: initial.sort ?? 'newest', status: initial.status ?? '' });
  const [data, setData] = useState(null),[categories, setCategories] = useState([]),[skills, setSkills] = useState([]),[error, setError] = useState(null),[attempt, setAttempt] = useState(0),[loading, setLoading] = useState(true);
  useEffect(() => {
    if (mine && user?.role !== 'CLIENT') return;
    let active = true;setLoading(true);setError(null);
    Promise.all([api(`${path}${query}`), api('/categories'), api('/skills')]).then(([result, reference, catalog]) => {if (active) {setData(result);setCategories(reference.categories);setSkills(catalog.skills);}}).
    catch((problem) => {if (active) setError(problem);}).finally(() => {if (active) setLoading(false);});
    return () => {active = false;};
  }, [path, query, user?.id, user?.role, mine, attempt]);
  if (mine && user?.role !== 'CLIENT') return <AccessDenied />;
  function filter(event) {event.preventDefault();const params = new URLSearchParams();for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value);window.location.assign(`${path}?${params}`);}
  function pageUrl(page) {const params = new URLSearchParams(query);params.set('page', page);return `${path}?${params}`;}
  const field = (key, label, type = 'text') => <div className="field"><label htmlFor={`filter-${key}`}>{label}</label><input id={`filter-${key}`} type={type} value={filters[key]} min={type === 'number' ? '0' : undefined} step={type === 'number' ? '0.01' : undefined} maxLength={key === 'search' ? 100 : undefined} onChange={(event) => setFilters({ ...filters, [key]: event.target.value })} /></div>;
  const select = (key, label, options) => <div className="field"><label htmlFor={`filter-${key}`}>{label}</label><select id={`filter-${key}`} value={filters[key]} onChange={(event) => setFilters({ ...filters, [key]: event.target.value })}>{options.map(([value, name]) => <option key={value} value={value}>{name}</option>)}</select></div>;
  return <><div className="profile-page-heading"><div><p className="eyebrow">{mine ? t("Ваши задачи и идеи") : t("Работа начинается здесь")}</p><h1>{mine ? t("Мои проекты") : t("Каталог проектов")}</h1><p className="profile-help">{mine ? t("От черновика до результата — все ваши проекты в одном месте.") : t("Открытые задачи для разработчиков, дизайнеров и IT-команд.")}</p></div>
    {user?.role === 'CLIENT' && <a className="button-link" href={mine ? '/projects/new' : '/me/projects'}>{mine ? t("+ Создать проект") : t("Мои проекты ↗")}</a>}</div>
    <div className="projects-layout"><aside className="profile-card project-filters"><form onSubmit={filter}><h2>{t("Поиск и фильтры")}</h2>{field('search', t("Поиск по проектам"))}
      {select('category', t("Категория"), [['', t("Все категории")], ...categories.map((category) => [category.slug, category.name])])}
      {select('skill', t("Навык"), [['', t("Любой навык")], ...skills.map((skill) => [skill.slug, skill.name])])}
      <div className="budget-filters">{field('minBudget', t("Бюджет от"), 'number')}{field('maxBudget', t("Бюджет до"), 'number')}</div>
      {mine && select('status', t("Статус"), [['', t("Все статусы")], ...Object.entries(statuses)])}
      {select('sort', t("Сортировка"), [['newest', t("Сначала новые")], ['oldest', t("Сначала старые")], ['budget_desc', t("Бюджет по убыванию")], ['budget_asc', t("Бюджет по возрастанию")], ['deadline_asc', t("Ближайший срок")]])}
      <button type="submit" className="submit">{t("Применить фильтры ")}<span aria-hidden="true">↗</span></button><a className="filter-reset text-link" href={path}>{t("Сбросить")}</a>
    </form></aside><section className="project-results" aria-label={mine ? t("Ваши проекты") : t("Открытые проекты")}>
      {loading ? <div className="profile-card" role="status">{t("Загружаем проекты…")}</div> : error ? <div className="profile-card"><ErrorMessage error={error} /><button className="secondary" onClick={() => setAttempt((value) => value + 1)}>{t("Повторить")}</button></div> : <>
        <p className="project-result-count" role="status">{t("Найдено проектов: ")}{data.total}</p>{data.items.map((project) => <ProjectCard key={project.id} project={project} />)}
        {!data.items.length && <div className="profile-card project-empty"><h2>{data.total ? t("На этой странице нет проектов") : t("Проекты не найдены")}</h2><p className="profile-help">{mine && !query ? t("Создайте черновик, добавьте описание и опубликуйте задание.") : t("Попробуйте изменить фильтры или вернуться на первую страницу.")}</p><a className="text-link" href={path}>{t("Вернуться к списку")}</a></div>}
        <Pagination data={data} href={pageUrl} label={t("Страницы проектов")} />
      </>}
    </section></div></>;
}

export function ProjectDetailsPage({ projectId, user }) {
  const [project, setProject] = useState(null),[error, setError] = useState(null),[loading, setLoading] = useState(true),[attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false),[action, setAction] = useState(null),[reason, setReason] = useState(''),[message, setMessage] = useState('');
  useEffect(() => {let active = true;setLoading(true);setProject(null);setError(null);api(`/projects/${encodeURIComponent(projectId)}`).then((data) => {if (active) setProject(data.project);}).
    catch((problem) => {if (active) setError(problem);}).finally(() => {if (active) setLoading(false);});return () => {active = false;};}, [projectId, user?.id, attempt]);
  async function command(kind) {setBusy(true);setError(null);setMessage('');try {
      if (kind === 'delete') {await api(`/projects/${projectId}`, { method: 'DELETE' });window.location.assign('/me/projects');return;}
      const result = await api(`/projects/${projectId}/${kind}`, { method: 'POST', body: kind === 'cancel' ? { reason } : {} });setProject(result.project);setAction(null);setMessage(kind === 'publish' ? t("Проект опубликован в каталоге") : t("Проект отменён"));
    } catch (problem) {setError(problem);} finally {setBusy(false);}}
  if (loading) return <div className="profile-card" role="status">{t("Загружаем проект…")}</div>;
  if (!project) return <section className="profile-card"><h1>{t("Не удалось открыть проект")}</h1><ErrorMessage error={error} />{error?.status !== 404 && <button onClick={() => setAttempt((value) => value + 1)}>{t("Повторить")}</button>}<a className="text-link" href="/projects">{t("В каталог")}</a></section>;
  const editable = project.isOwn && user?.role === 'CLIENT' && ['DRAFT', 'OPEN'].includes(project.status);
  return <><div className="profile-page-heading"><div><p className="eyebrow">{t(project.category?.name) ?? t("Новый проект")}</p><h1 className="project-title">{project.title}</h1><div className="project-card-top"><Badge status={project.status} />{project.isOwn && <span className="project-own">{t("Ваш проект")}</span>}</div></div><a className="text-link" href={project.isOwn ? '/me/projects' : '/projects'}>{t("← К проектам")}</a></div>
    <div className="project-detail-layout"><div className="profile-editor"><section className="profile-card"><h2>{t("О задаче")}</h2><p className="public-description">{project.description || t("Описание пока не добавлено.")}</p><Tags skills={project.skills} /></section>
      <section className="profile-card"><h2>{t("Вложения")}</h2>{project.files.length ? <div className="attachment-list">{project.files.map((file) => <FileLink key={file.id} file={file} privateFile={project.status !== 'OPEN'} />)}</div> : <p className="profile-help">{t("Вложений пока нет.")}</p>}</section>
      {project.cancellationReason && <section className="profile-card"><h2>{t("Причина отмены")}</h2><p className="public-description">{project.cancellationReason}</p></section>}
      <ProjectProposals key={`${project.id}-${user?.id ?? 'guest'}`} project={project} user={user} onProjectChange={() => api(`/projects/${projectId}`).then((data) => {setProject(data.project);setAction(null);}).catch(setError)} />
      {project.isOwn && user?.role === 'CLIENT' && <section className="profile-card"><h2>{t("Приглашения на проект")}</h2><p className="profile-help">{project.status === 'OPEN' ? t("Откройте профиль исполнителя в каталоге, чтобы предложить ему этот проект.") : t("История приглашений и решений по этому проекту.")}</p><a className="text-link" href="/freelancers">{t("Найти исполнителя ↗")}</a><InvitationList key={`${project.id}-${user.id}`} path={`/projects/${project.id}/invitations`} revision={project.status} /></section>}
    </div><aside className="profile-card project-summary"><p className="eyebrow">{t("Условия проекта")}</p><p className="project-budget">{money(project.budget)}</p><dl><dt>{t("Желаемый срок")}</dt><dd>{date(project.desiredDeadlineAt)}</dd><dt>{t("Заказчик")}</dt><dd><a className="text-link" href={`/users/${project.customer.id}`}>{project.customer.firstName} {project.customer.lastName}</a></dd><dt>{t("Создан")}</dt><dd>{date(project.createdAt)}</dd></dl>
      {editable && <div className="project-owner-actions"><a className="button-link" href={`/projects/${project.id}/edit`}>{t("Редактировать проект")}</a>{project.status === 'DRAFT' && <button disabled={busy} onClick={() => command('publish')}>{t("Опубликовать проект ↗")}</button>}
        <button className="secondary" disabled={busy} onClick={() => {setAction('cancel');setError(null);}}>{t("Отменить проект")}</button>{project.status === 'DRAFT' && <button className="text-button danger" disabled={busy} onClick={() => {setAction('delete');setError(null);}}>{t("Удалить черновик")}</button>}</div>}
      {action === 'cancel' && <form className="project-confirm" onSubmit={(event) => {event.preventDefault();command('cancel');}}><fieldset disabled={busy}><div className="field"><label htmlFor="cancel-reason">{t("Причина отмены проекта")}</label><textarea id="cancel-reason" required maxLength={1000} rows={3} value={reason} onChange={(event) => setReason(event.target.value)} /></div><p className="profile-help">{t("Проект останется в вашей истории и уйдёт из каталога.")}</p><button type="submit">{t("Подтвердить отмену")}</button><button type="button" className="text-button" onClick={() => setAction(null)}>{t("Продолжить работу")}</button></fieldset></form>}
      {action === 'delete' && <div className="project-confirm"><p>{t("Удалить черновик и его вложения?")}</p><button disabled={busy} onClick={() => command('delete')}>{t("Да, удалить черновик")}</button><button className="text-button" disabled={busy} onClick={() => setAction(null)}>{t("Оставить")}</button></div>}
      <ErrorMessage error={error} /><p className="save-message" role="status">{message}</p>{project.status === 'DRAFT' && <p className="profile-help">{t("Черновик доступен только вам. Для публикации нужны описание и категория.")}</p>}
    </aside></div></>;
}

const localDate = (value) => value ? new Date(new Date(value).getTime() - new Date(value).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '';
const asForm = (project) => ({ title: project?.title ?? '', description: project?.description ?? '', categoryId: project?.category?.id ?? '', budget: project?.budget ?? '',
  desiredDeadlineAt: localDate(project?.desiredDeadlineAt), skillIds: project?.skills.map((skill) => skill.id) ?? [], files: project?.files ?? [] });
const sameIds = (a, b) => a.length === b.length && a.every((id) => b.includes(id));
export function ProjectEditorPage({ projectId, user }) {
  const [original, setOriginal] = useState(null),[draft, setDraft] = useState(null),[project, setProject] = useState(null),[categories, setCategories] = useState([]),[skills, setSkills] = useState([]),[available, setAvailable] = useState([]);
  const [loading, setLoading] = useState(true),[loadError, setLoadError] = useState(null),[error, setError] = useState(null),[attempt, setAttempt] = useState(0),[busy, setBusy] = useState(false),[uploading, setUploading] = useState(false);
  useEffect(() => {
    if (user.role !== 'CLIENT') return;let active = true;setLoading(true);setLoadError(null);
    Promise.all([projectId ? api(`/projects/${encodeURIComponent(projectId)}`) : Promise.resolve({ project: null }), api('/categories'), api('/skills'), api('/files')]).
    then(([data, reference, catalog, files]) => {if (active) {setProject(data.project);setDraft(asForm(data.project));setOriginal(asForm(data.project));setCategories(reference.categories);setSkills(catalog.skills);setAvailable(files.files);}}).
    catch((problem) => {if (active) setLoadError(problem);}).finally(() => {if (active) setLoading(false);});return () => {active = false;};
  }, [projectId, user.id, user.role, attempt]);
  if (user.role !== 'CLIENT') return <AccessDenied />;
  if (loading) return <div className="profile-card" role="status">{t("Загружаем форму…")}</div>;
  if (loadError) return <section className="profile-card"><h1>{t("Не удалось открыть форму")}</h1><ErrorMessage error={loadError} /><button onClick={() => setAttempt((value) => value + 1)}>{t("Повторить")}</button></section>;
  if (project && (!project.isOwn || !['DRAFT', 'OPEN'].includes(project.status))) return <section className="profile-card"><h1>{t("Редактирование недоступно")}</h1><p className="profile-help">{t("Изменять можно только свои черновики и открытые проекты.")}</p><a className="text-link" href={`/projects/${project.id}`}>{t("К карточке проекта")}</a></section>;
  const changed = ['title', 'description', 'categoryId', 'budget', 'desiredDeadlineAt'].some((key) => draft[key] !== original[key]) || !sameIds(draft.skillIds, original.skillIds) || !sameIds(draft.files.map((file) => file.id), original.files.map((file) => file.id));
  const locked = busy || uploading;
  async function save(event) {
    event.preventDefault();setBusy(true);setError(null);
    try {
      const body = {};for (const key of ['title', 'description', 'categoryId', 'budget', 'desiredDeadlineAt']) if (!projectId || draft[key] !== original[key]) body[key] = key === 'desiredDeadlineAt' ? draft[key] ? new Date(draft[key]).toISOString() : null : ['categoryId', 'budget'].includes(key) ? draft[key] || null : draft[key];
      if (!projectId || !sameIds(draft.skillIds, original.skillIds)) body.skillIds = draft.skillIds;
      if (!projectId || !sameIds(draft.files.map((file) => file.id), original.files.map((file) => file.id))) body.fileIds = draft.files.map((file) => file.id);
      const result = await api(projectId ? `/projects/${projectId}` : '/projects', { method: projectId ? 'PATCH' : 'POST', body });window.location.assign(`/projects/${result.project.id}`);
    }
    catch (problem) {setError(problem);} finally {setBusy(false);}
  }
  async function addFile(event) {const file = event.target.files?.[0];event.target.value = '';if (!file) return;setUploading(true);setError(null);
    try {const uploaded = await uploadFile(file);setDraft((previous) => ({ ...previous, files: [...previous.files, uploaded] }));const result = await api('/files');setAvailable(result.files);} catch (problem) {setError(problem);} finally {setUploading(false);}}
  const unused = available.filter((file) => !file.inUse && !draft.files.some((value) => value.id === file.id));
  return <><div className="profile-page-heading"><div><p className="eyebrow">{t("Превратите идею в задачу")}</p><h1>{projectId ? t("Редактирование проекта") : t("Новый проект")}</h1></div><a className="text-link" href={projectId ? `/projects/${projectId}` : '/me/projects'}>{t("← Назад")}</a></div>
    <section className="profile-card project-editor-card"><ErrorMessage error={error} /><form onSubmit={save}><fieldset disabled={locked}>
      <div className="field"><label htmlFor="project-title">{t("Название проекта")}</label><input id="project-title" required maxLength={200} value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></div>
      <div className="field"><label htmlFor="project-description">{t("Описание задачи")}</label><textarea id="project-description" rows={7} maxLength={10000} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /><small>{t("Опишите цель, ожидаемый результат и важные требования.")}</small></div>
      <div className="profile-fields"><div className="field"><label htmlFor="project-category">{t("Категория проекта")}</label><select id="project-category" value={draft.categoryId} onChange={(event) => setDraft({ ...draft, categoryId: event.target.value })}><option value="">{t("Выбрать позже")}</option>{categories.map((category) => <option value={category.id} key={category.id}>{t(category.name)}</option>)}</select></div>
        <div className="field"><label htmlFor="project-budget">{t("Бюджет")}</label><input id="project-budget" type="number" min="0.01" max="9999999999.99" step="0.01" value={draft.budget} onChange={(event) => setDraft({ ...draft, budget: event.target.value })} /><small>{t("Можно оставить пустым и обсудить с исполнителем.")}</small></div>
        <div className="field"><label htmlFor="project-deadline">{t("Желаемый срок")}</label><input id="project-deadline" type="datetime-local" value={draft.desiredDeadlineAt} onChange={(event) => setDraft({ ...draft, desiredDeadlineAt: event.target.value })} /><small>{t("Время в вашем часовом поясе. Поле необязательное.")}</small></div></div>
      <h2>{t("Нужные навыки · ")}{draft.skillIds.length}/20</h2><div className="skill-options">{skills.map((skill) => <label className={draft.skillIds.includes(skill.id) ? 'skill-option selected' : 'skill-option'} key={skill.id}><input type="checkbox" checked={draft.skillIds.includes(skill.id)} disabled={draft.skillIds.length >= 20 && !draft.skillIds.includes(skill.id)} onChange={(event) => setDraft({ ...draft, skillIds: event.target.checked ? [...draft.skillIds, skill.id] : draft.skillIds.filter((id) => id !== skill.id) })} />{skill.name}</label>)}</div>
      <h2>{t("Вложения · ")}{draft.files.length}/8</h2>{draft.files.map((file) => <div className="attachment-row" key={file.id}><FileLink file={file} privateFile /><button type="button" className="text-button danger" onClick={() => setDraft({ ...draft, files: draft.files.filter((value) => value.id !== file.id) })}>{t("Убрать")}</button></div>)}
      <label className="upload-label">{uploading ? t("Загружаем…") : t("+ Прикрепить файл")}<input type="file" accept=".png,.jpg,.jpeg,.webp,.gif,.bmp,.pdf,.txt,.docx,.zip,.mp4" disabled={locked || draft.files.length >= 8} onChange={addFile} /></label><p className="profile-help">{t("До 10 МБ на файл. Вложения черновика видны только вам, опубликованного проекта — всем.")}</p>
      {draft.files.length < 8 && unused.length > 0 && <details className="available-files"><summary>{t("Ранее загруженные файлы · ")}{unused.length}</summary>{unused.map((file) => <button key={file.id} type="button" className="file-choice" onClick={() => setDraft({ ...draft, files: [...draft.files, file] })}>+ {file.originalName}</button>)}</details>}
      {project?.status === 'OPEN' && <p className="project-edit-notice">{t("Изменение условий закроет ожидающие отклики и приглашения. Исполнители смогут отправить новые предложения.")}</p>}
      <div className="profile-form-actions"><button type="submit" disabled={Boolean(projectId) && !changed}>{busy ? t("Сохраняем…") : projectId ? t("Сохранить изменения") : t("Сохранить черновик")}</button><a className="text-link" href={projectId ? `/projects/${projectId}` : '/me/projects'}>{t("Отменить изменения")}</a></div>
      <p className="profile-help">{projectId ? t("Убранные вложения удалятся после сохранения.") : t("После сохранения можно проверить карточку и опубликовать проект.")}{t(" Новые загрузки при отмене останутся в свободных файлах вашего профиля.")}</p>
    </fieldset></form></section></>;
}

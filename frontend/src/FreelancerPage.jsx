import { navigate, getLocation } from './navigation.js';
import { Link } from './Navigation.jsx';
import { t, locale } from "./i18n.js";import React, { useEffect, useState } from 'react';
import { api } from './api.js';
export function FreelancerPage() {
  const query = getLocation().search,initial = Object.fromEntries(new URLSearchParams(query));
  const [filters, setFilters] = useState({ search: initial.search ?? '', skill: initial.skill ?? '', minRating: initial.minRating ?? '', sort: initial.sort ?? 'rating' });
  const [data, setData] = useState(null),[skills, setSkills] = useState([]),[loading, setLoading] = useState(true),[error, setError] = useState(null),[attempt, setAttempt] = useState(0);
  useEffect(() => {let active = true;setLoading(true);setError(null);Promise.all([api(`/freelancers${query}`), api('/skills')]).then(([result, catalog]) => {if (active) {setData(result);setSkills(catalog.skills);}}).catch((problem) => {if (active) setError(problem);}).finally(() => {if (active) setLoading(false);});return () => {active = false;};}, [query, attempt]);
  function filter(event) {event.preventDefault();const params = new URLSearchParams();for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value);navigate(`/freelancers?${params}`);}
  function pageUrl(page) {const params = new URLSearchParams(query);params.set('page', page);return `/freelancers?${params}`;}
  const select = (key, label, options) => <div className="field"><label htmlFor={`freelancer-${key}`}>{label}</label><select id={`freelancer-${key}`} value={filters[key]} onChange={(event) => setFilters({ ...filters, [key]: event.target.value })}>{options.map(([value, name]) => <option key={value} value={value}>{name}</option>)}</select></div>;
  return <><div className="profile-page-heading"><div><p className="eyebrow">{t("Люди для ваших проектов")}</p><h1>{t("Найти исполнителя")}</h1><p className="profile-help">{t("Выберите специалиста по навыкам, познакомьтесь с работами и предложите проект.")}</p></div><Link className="text-link" href="/projects">{t("Каталог проектов ↗")}</Link></div>
    <div className="projects-layout"><aside className="profile-card project-filters"><form onSubmit={filter}><h2>{t("Поиск и фильтры")}</h2><div className="field"><label htmlFor="freelancer-search">{t("Имя или username")}</label><input id="freelancer-search" type="search" maxLength={100} value={filters.search} onChange={(event) => setFilters({ ...filters, search: event.target.value })} /></div>
      {select('skill', t("Навык"), [['', t("Любой навык")], ...skills.map((skill) => [skill.slug, t(skill.name)])])}{select('minRating', t("Минимальный рейтинг"), [['', t("Любой, включая без отзывов")], ['3', t("3 и выше")], ['4', t("4 и выше")], ['4.5', t("4,5 и выше")], ['5', '5']])}
      {select('sort', t("Сортировка"), [['rating', t("Сначала по рейтингу")], ['name', t("По имени")]])}<button type="submit" className="submit">{t("Найти исполнителей ")}<span aria-hidden="true">↗</span></button><Link className="filter-reset text-link" href="/freelancers">{t("Сбросить")}</Link>
    </form></aside><section className="project-results" aria-label={t("Исполнители")}>
      {loading ? <div className="profile-card" role="status">{t("Загружаем исполнителей…")}</div> : error ? <div className="profile-card"><p className="form-error" role="alert">{error.message}</p><button className="secondary" onClick={() => setAttempt((value) => value + 1)}>{t("Повторить")}</button></div> : <>
        <p className="project-result-count" role="status">{t("Найдено исполнителей: ")}{data.total}</p>{data.items.map((person) => <article className="profile-card freelancer-card" key={person.id}>
          <div className="freelancer-heading"><div className="profile-avatar">{person.avatarFileId ? <img src={`/api/files/${person.avatarFileId}`} alt="" /> : `${person.firstName[0]}${person.lastName[0]}`}</div><div><h2><Link href={`/users/${person.id}`}>{person.firstName} {person.lastName}</Link></h2><p className="profile-handle">@{person.username}</p></div><span className="freelancer-rating">{person.freelancerRating === null ? t("Без отзывов") : `★ ${new Intl.NumberFormat(locale(), { maximumFractionDigits: 2 }).format(Number(person.freelancerRating))}`}<small>{t("Отзывов: ")}{person.freelancerReviewCount}</small></span></div>
          <p className="public-description">{person.headline || t("Специалист пока не добавил описание.")}</p>{(person.city || person.country) && <p className="profile-location">{[person.city, person.country].filter(Boolean).join(', ')}</p>}
          <div className="profile-tags">{person.skills.map((skill) => <span key={skill.id}>{t(skill.name)}</span>)}</div><Link className="text-link" href={`/users/${person.id}`}>{t("Профиль и приглашение в проект ↗")}</Link>
        </article>)}
        {!data.items.length && <div className="profile-card project-empty"><h2>{t("Исполнители не найдены")}</h2><p className="profile-help">{t("Попробуйте изменить поиск или фильтры. Рейтинг появляется после первых отзывов.")}</p><Link className="text-link" href="/freelancers">{t("Вернуться ко всем исполнителям")}</Link></div>}
        {data.total > 0 && <nav className="project-pagination" aria-label={t("Страницы исполнителей")}>{data.page > 1 && <Link href={pageUrl(data.page - 1)}>{t("← Назад")}</Link>}<span>{t("Страница ")}{data.page}{t(" из ")}{Math.ceil(data.total / data.pageSize)}</span>{data.page * data.pageSize < data.total && <Link href={pageUrl(data.page + 1)}>{t("Далее →")}</Link>}</nav>}
      </>}
    </section></div></>;
}

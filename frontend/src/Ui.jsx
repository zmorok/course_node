import { navigate, getLocation } from './navigation.js';
import { Link } from './Navigation.jsx';
import { t, locale } from "./i18n.js";import React, { useEffect, useState } from 'react';
import { api } from './api.js';

export function ErrorMessage({ error }) {
  if (!error) return null;
  const details = [...new Set(error.details?.map((issue) => t(issue.message)) ?? [])];
  return <div className="form-error" role="alert"><strong>{t(error.message)}</strong>{details.length > 0 && <ul>{details.map((message) => <li key={message}>{t(message)}</li>)}</ul>}</div>;
}
export function StatusBadge({ status, labels }) {
  return <span className={`project-status status-${String(status).toLowerCase()}`}>{labels?.[status] ?? status}</span>;
}
export function Pagination({ data, page = data.page, onPage, href, label = t("Страницы списка"), disabled = false }) {
  if (!data.total) return null;
  const pages = Math.ceil(data.total / data.pageSize);
  const link = (next, text) => href ? <Link href={href(next)}>{text}</Link> : <button className="text-button" disabled={disabled} onClick={() => onPage(next)}>{text}</button>;
  if (page > pages) return <nav className="project-pagination" aria-label={label}><span>{t("На этой странице записей нет")}</span>{link(1, t("В начало списка"))}</nav>;
  return <nav className="project-pagination" aria-label={label}>{page > 1 && link(page - 1, t("← Назад"))}<span aria-live="polite">{t("Страница ")}{page}{t(" из ")}{pages}</span>{page * data.pageSize < data.total && link(page + 1, t("Далее →"))}</nav>;
}
export function listPage(page) {const next = new URLSearchParams(getLocation().search);next.set('page', page);navigate(`${getLocation().pathname}?${next}`);}
export function useRemote(path) {
  const [entry, setEntry] = useState({ path, data: null, error: null, loading: true });
  useEffect(() => {let active = true;setEntry({ path, data: null, error: null, loading: true });api(path).then((data) => {if (active) setEntry({ path, data, error: null, loading: false });}).catch((error) => {if (active) setEntry({ path, data: null, error, loading: false });});return () => {active = false;};}, [path]);
  async function reload() {try {const data = await api(path);setEntry({ path, data, error: null, loading: false });} catch (error) {setEntry({ path, data: null, error, loading: false });throw error;}}
  const current = entry.path === path ? entry : { data: null, error: null, loading: true };return { ...current, reload };
}
export function RemoteState({ remote, children }) {return remote.loading ? <section className="profile-card" role="status">{t("Загружаем данные…")}</section> : remote.error ? <section className="profile-card"><ErrorMessage error={remote.error} /><button className="secondary" onClick={() => remote.reload().catch(() => {})}>{t("Повторить загрузку")}</button></section> : children;}
export function Pages({ data, onPage }) {return <Pagination data={data} onPage={onPage} />;}

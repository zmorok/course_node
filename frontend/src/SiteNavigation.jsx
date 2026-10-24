import React, { useEffect, useRef } from 'react';
import { getLocation } from './navigation.js';
import { Link, useLocation } from './Navigation.jsx';
import { t } from './i18n.js';
import { Icon } from './Icon.jsx';

const publicItems = () => [['/projects', t('Каталог проектов'), 'folder'], ['/freelancers', t('Исполнители'), 'user']];
function workspaceItems(user) {
  return user?.role === 'ADMIN' ? [
    ['/admin/users', t('Пользователи'), 'user'], ['/admin/users/new', t('Создать пользователя'), 'plus'],
    ['/admin/complaints', t('Жалобы'), 'exclamation-circle'], ['/admin/audit', t('Журнал аудита'), 'document-text'],
    ['/me/notifications', t('Уведомления'), 'bell'], ['/me/profile', t('Мой профиль'), 'user'], ['/', t('Аккаунт'), 'folder'],
  ] : [
    ['/me/projects', t('Мои проекты'), 'folder'], ['/me/proposals', t('Мои отклики'), 'document-text'],
    ['/me/invitations', t('Приглашения'), 'paper-clip'], ['/me/orders', t('Заказы'), 'archive-box'],
    ['/me/reviews', t('Отзывы'), 'star'], ['/me/complaints', t('Жалобы'), 'exclamation-circle'],
    ['/me/warnings', t('Предупреждения'), 'information-circle'], ['/me/notifications', t('Уведомления'), 'bell'],
    ['/me/profile', t('Мой профиль'), 'user'], ['/', t('Аккаунт'), 'folder'],
  ];
}
function current(url) {
  const path = getLocation().pathname;
  if (url === '/projects') return path === url || /^\/projects\/[^/]+\/?$/.test(path) && path !== '/projects/new';
  if (url === '/me/projects') return path === url || path === '/projects/new' || /^\/projects\/[^/]+\/edit\/?$/.test(path);
  if (url === '/me/orders') return path === url || path.startsWith('/orders/');
  if (url === '/admin/users') return path === url || /^\/admin\/users\/(?!new\/?$)/.test(path);
  return path === url || url !== '/' && path.startsWith(`${url}/`);
}
function NavLink({ item, icon = false }) {
  const [url, label, glyph] = item;
  return <Link href={url} aria-current={current(url) ? 'page' : undefined}>{icon && <Icon name={glyph} />}<span>{label}</span></Link>;
}
export function SiteNavigation() {
  return <nav className="profile-nav" aria-label={t('Навигация')}>{publicItems().map(item => <NavLink key={item[0]} item={item} />)}</nav>;
}
export function WorkspaceNavigation({ user }) {
  return <aside className="workspace-sidebar"><p className="sidebar-title">{t('Ваше рабочее пространство')}</p><nav aria-label={t('Личный кабинет')}>{workspaceItems(user).map(item => <NavLink key={item[0]} item={item} icon />)}</nav></aside>;
}
export function MobileNavigation({ user }) {
  const { pathname, search } = useLocation();
  const menu = useRef(null);
  useEffect(() => {if (menu.current) menu.current.open = false;}, [pathname, search, user?.id]);
  useEffect(() => {
    const close = event => {if (event.type === 'keydown' ? event.key === 'Escape' : !menu.current?.contains(event.target)) {
      if (menu.current?.open) {menu.current.open = false;if (event.type === 'keydown') menu.current.querySelector('summary')?.focus();}
    }};
    document.addEventListener('pointerdown', close);document.addEventListener('keydown', close);
    return () => {document.removeEventListener('pointerdown', close);document.removeEventListener('keydown', close);};
  }, []);
  return <details className="mobile-navigation" ref={menu}><summary className="icon-button" aria-label={t('Открыть меню')}><Icon name="bars-3" /></summary>
    <nav className="mobile-menu" aria-label={t('Мобильная навигация')}>{[...publicItems(), ...(user ? workspaceItems(user) : [['/', t('Войти'), 'user']])].map(item => <NavLink key={item[0]} item={item} icon />)}</nav>
  </details>;
}

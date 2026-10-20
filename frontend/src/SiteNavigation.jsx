import { getLocation } from './navigation.js';
import { Link } from './Navigation.jsx';
import { t, locale } from "./i18n.js";import React from 'react';
import { NotificationLink } from './Notifications.jsx';
export function SiteNavigation({ user }) {
  const path = getLocation().pathname;
  const current = (url) => path === url || url === '/me/orders' && path.startsWith('/orders/') || url === '/me/complaints' && path.startsWith('/me/complaints/') || url === '/admin/complaints' && path.startsWith('/admin/');
  const link = ([url, label]) => <Link key={url} href={url} aria-current={current(url) ? 'page' : undefined}>{label}</Link>;
  if (!user) return <nav className="profile-nav" aria-label={t("Навигация")}>{[['/projects', t("Каталог проектов")], ['/freelancers', t("Исполнители")], ['/', t("Войти")]].map(link)}</nav>;
  const primary = [['/projects', t("Каталог")], ['/freelancers', t("Исполнители")], ...(user.role === 'CLIENT' ? [['/me/projects', t("Мои проекты")], ['/me/orders', t("Заказы")]] : [['/admin/complaints', t("Администрирование")]])];
  const secondary = [...(user.role === 'CLIENT' ? [['/me/proposals', t("Мои отклики")], ['/me/invitations', t("Приглашения")], ['/me/reviews', t("Отзывы")], ['/me/complaints', t("Жалобы")], ['/me/warnings', t("Предупреждения")]] : []), ['/me/profile', t("Мой профиль")], ['/', t("Аккаунт")]];
  return <nav className="profile-nav" aria-label={t("Навигация")}>{primary.map(link)}<NotificationLink key={user.id} current={path === '/me/notifications'} /><details className="nav-more"><summary className={secondary.some(([url]) => current(url)) ? 'nav-more-current' : undefined}>{t("Ещё")}</summary><div className="nav-menu">{secondary.map(link)}</div></details></nav>;
}

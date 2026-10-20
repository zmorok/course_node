import React from 'react';
import {NotificationLink} from './Notifications.jsx';
export function SiteNavigation({user}) {
  const path=window.location.pathname;
  const current=url=>path===url||(url==='/me/orders'&&path.startsWith('/orders/'))||(url==='/me/complaints'&&path.startsWith('/me/complaints/'))||(url==='/admin/complaints'&&path.startsWith('/admin/'));
  const link=([url,label])=><a key={url} href={url} aria-current={current(url)?'page':undefined}>{label}</a>;
  if(!user)return <nav className="profile-nav" aria-label="Навигация">{[['/projects','Каталог проектов'],['/freelancers','Исполнители'],['/','Войти']].map(link)}</nav>;
  const primary=[['/projects','Каталог'],['/freelancers','Исполнители'],...(user.role==='CLIENT'?[['/me/projects','Мои проекты'],['/me/orders','Заказы']]:[['/admin/complaints','Администрирование']])];
  const secondary=[...(user.role==='CLIENT'?[['/me/proposals','Мои отклики'],['/me/invitations','Приглашения'],['/me/reviews','Отзывы'],['/me/complaints','Жалобы'],['/me/warnings','Предупреждения']]:[]),['/me/profile','Мой профиль'],['/','Аккаунт']];
  return <nav className="profile-nav" aria-label="Навигация">{primary.map(link)}<NotificationLink key={user.id} current={path==='/me/notifications'}/><details className="nav-more"><summary className={secondary.some(([url])=>current(url))?'nav-more-current':undefined}>Ещё</summary><div className="nav-menu">{secondary.map(link)}</div></details></nav>;
}

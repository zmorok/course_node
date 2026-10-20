import { Link, useLocation, RouteFocus } from './Navigation.jsx';
import { uiMessage, t, locale } from "./i18n.js";import { Preferences, usePreferences } from './Preferences.jsx';
import { SiteNavigation } from './SiteNavigation.jsx';
import { NotificationsPage } from './Notifications.jsx';
import React, { useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { AuthPanel, AccountPanel } from './AuthPanel.jsx';
import { authenticate, restoreSession, logout, api } from './api.js';
import { ProfilePage, PublicProfilePage } from './ProfilePage.jsx';
import { ProjectListPage, ProjectDetailsPage, ProjectEditorPage } from './ProjectPages.jsx';
import { OwnProposalsPage } from './ProposalPages.jsx';
import { FreelancerPage } from './FreelancerPage.jsx';
import { OwnInvitationsPage } from './InvitationPages.jsx';
import { OrderListPage, OrderDetailsPage } from './OrderPages.jsx';
import { MyReviewsPage } from './Reviews.jsx';
import { ComplaintsPage, WarningsPage } from './Complaints.jsx';
import { AdminPage } from './AdminPage.jsx';
import { AuditPage } from './AuditPage.jsx';

function App() {
  const location = useLocation();
  usePreferences();
  const [user, setUser] = useState(null);
  const [restoring, setRestoring] = useState(true);
  const [notice, setNotice] = useState(new URLSearchParams(location.search).has('passwordChanged') ? t("Пароль изменён. Войдите с новым паролем.") : '');
  const [restoreFailed, setRestoreFailed] = useState(false);
  async function restore() {
    setRestoring(true);setRestoreFailed(false);setNotice('');
    try {setUser(await restoreSession());}
    catch (error) {
      if (error.status !== 401) {setNotice(error.message);setRestoreFailed(error.status !== 403);}
    } finally {setRestoring(false);}
  }
  useEffect(() => {
    let active = true;
    restoreSession().then((value) => {if (active) setUser(value);}).catch((error) => {
      if (active && error.status !== 401) {setNotice(error.message);setRestoreFailed(error.status !== 403);}
    }).finally(() => {if (active) setRestoring(false);});
    const ended = (event) => {setUser(null);setNotice(event.detail ?? uiMessage("Вы вышли из аккаунта"));};
    window.addEventListener('workify:session-ended', ended);
    return () => {active = false;window.removeEventListener('workify:session-ended', ended);};
  }, []);
  const [connection, setConnection] = useState('checking');
  const checkConnection = useCallback(async (signal) => {
    setConnection('checking');
    try {
      const timeout = AbortSignal.timeout(6000);
      const response = await fetch('/api/health', { signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
      const data = await response.json();
      if (!response.ok || data.status !== 'ok') throw new Error('Service unavailable');
      if (!signal?.aborted) setConnection('ready');
    } catch {
      if (!signal?.aborted) setConnection('unavailable');
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    checkConnection(controller.signal);
    return () => controller.abort();
  }, [checkConnection]);

  const labels = { checking: t("Проверяем подключение…"), ready: t("Подключение установлено"), unavailable: t("Сервис временно недоступен") };
  const publicMatch = /^\/users\/([^/]+)\/?$/.exec(location.pathname);
  const ownProfile = /^\/me\/profile\/?$/.test(location.pathname);
  const catalog = /^\/projects\/?$/.test(location.pathname);
  const ownProjects = /^\/me\/projects\/?$/.test(location.pathname);
  const ownProposals = /^\/me\/proposals\/?$/.test(location.pathname);
  const freelancers = /^\/freelancers\/?$/.test(location.pathname);
  const ownInvitations = /^\/me\/invitations\/?$/.test(location.pathname);
  const ownOrders = /^\/me\/orders\/?$/.test(location.pathname);
  const ownReviews = /^\/me\/reviews\/?$/.test(location.pathname);
  const ownComplaints = /^\/me\/complaints\/?$/.test(location.pathname);
  const complaintMatch = /^\/me\/complaints\/([^/]+)\/?$/.exec(location.pathname);
  const ownWarnings = /^\/me\/warnings\/?$/.test(location.pathname);
  const ownNotifications = /^\/me\/notifications\/?$/.test(location.pathname);
  const adminView = /^\/admin(?:\/|$)/.test(location.pathname);
  const orderMatch = /^\/orders\/([^/]+)\/?$/.exec(location.pathname);
  const newProject = /^\/projects\/new\/?$/.test(location.pathname);
  const projectMatch = !newProject && /^\/projects\/([^/]+)(\/edit)?\/?$/.exec(location.pathname);
  const projectView = Boolean(catalog || freelancers || projectMatch && (!projectMatch[2] || user) || (newProject || ownProjects || ownProposals || ownInvitations || ownOrders || ownReviews || ownComplaints || complaintMatch || ownWarnings || ownNotifications || adminView || orderMatch) && user);
  const profileView = Boolean(publicMatch || ownProfile && user || projectView);
  return (
    <div className={profileView ? 'page profile-page' : 'page'}>
      <Link className="skip-link" href="#main-content">{t("К содержимому")}</Link>
      <header className="header">
        <Link className="brand" href="/" aria-label={t("Workify — главная")}><span className="brand-mark">w.</span>workify</Link>
        <SiteNavigation user={user} /><Preferences />
      </header>
      <RouteFocus /><main id="main-content" tabIndex={-1} className={profileView ? 'profile-main' : undefined}>
        <React.Fragment key={`${location.pathname}${location.search}:${user?.id ?? 'guest'}`} >{projectView && restoring ? <div className="profile-card" role="status">{t("Загружаем рабочее пространство…")}</div> :
        catalog ? <ProjectListPage user={user} /> :
        freelancers ? <FreelancerPage /> :
        ownProjects && user ? <ProjectListPage user={user} mine /> :
        ownProposals && user ? <OwnProposalsPage key={user.id} user={user} /> :
        ownInvitations && user ? <OwnInvitationsPage key={user.id} user={user} /> :
        ownOrders && user ? <OrderListPage key={user.id} user={user} /> :
        ownReviews && user ? <MyReviewsPage key={user.id} user={user} /> :
        (ownComplaints || complaintMatch) && user ? <ComplaintsPage key={user.id} user={user} complaintId={complaintMatch?.[1]} /> :
        ownNotifications && user ? <NotificationsPage key={user.id} /> :
        ownWarnings && user ? <WarningsPage key={user.id} user={user} /> :
        /^\/admin\/audit\/?$/.test(location.pathname) && user ? <AuditPage key={user.id} user={user} /> :
        adminView && user ? <AdminPage key={user.id} user={user} /> :
        orderMatch && user ? <OrderDetailsPage key={user.id} user={user} orderId={orderMatch[1]} /> :
        newProject && user ? <ProjectEditorPage user={user} /> :
        projectMatch && (!projectMatch[2] || user) ? projectMatch[2] ? <ProjectEditorPage projectId={projectMatch[1]} user={user} /> : <ProjectDetailsPage projectId={projectMatch[1]} user={user} /> :
        publicMatch ? <PublicProfilePage userId={publicMatch[1]} user={user} /> : ownProfile && user ? <ProfilePage user={user} onUserChange={setUser} /> : <>
        <section className="intro" aria-labelledby="welcome-title">
          <p className="eyebrow">{t("Ваше рабочее пространство")}</p>
          <h1 id="welcome-title">{t("Хорошие проекты")}<br />{t("начинаются с людей.")}</h1>
          <p className="lead">{t("Workify объединяет заказчика и исполнителя: от первого предложения до принятого результата.")}</p>
          <div className="connection" role="status" aria-live="polite">
            <span className={`indicator indicator-${connection}`} aria-hidden="true" />
            <span>{labels[connection]}</span>
          </div>
          <button type="button" onClick={() => checkConnection()} disabled={connection === 'checking'}>{t("Проверить подключение ")}<span aria-hidden="true">↗</span></button>
        </section>
        <aside className="auth-area" aria-label={t("Аккаунт Workify")}>
          {user ? <AccountPanel user={user} onLogout={logout}
            onRefresh={async () => {const result = await api('/auth/me');setUser(result.user);return uiMessage("Данные аккаунта обновлены");}}
            onAdminCheck={async () => {await api('/admin/access');return uiMessage("Доступ администратора подтверждён");}} /> :
            <AuthPanel restoring={restoring} notice={new URLSearchParams(location.search).has('passwordChanged') ? t("Пароль изменён. Войдите с новым паролем.") : notice} onAuthenticate={async (mode, values) => {setUser(await authenticate(mode, values));setNotice('');setRestoreFailed(false);}} />}
          {restoreFailed && !restoring && !user && <button className="restore-button secondary" onClick={restore}>{t("Повторить восстановление сессии")}</button>}
        </aside>
        </>}
      </React.Fragment></main>
      <footer><span>Workify</span><span>{t("Для работы, у которой есть результат.")}</span></footer>
    </div>);

}

createRoot(document.getElementById('root')).render(<React.StrictMode><App /></React.StrictMode>);

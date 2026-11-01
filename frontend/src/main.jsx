import { Link, useLocation, RouteFocus } from './Navigation.jsx';
import { uiMessage, t, locale } from './i18n.js';
import { Preferences, usePreferences } from './Preferences.jsx';
import { SiteNavigation, WorkspaceNavigation, MobileNavigation } from './SiteNavigation.jsx';
import { NotificationsPage, NotificationLink } from './Notifications.jsx';
import { navigate, isAppUrl } from './navigation.js';
import { Icon } from './Icon.jsx';
import React, { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { AuthPanel, AccountPanel } from './AuthPanel.jsx';
import { authenticate, restoreSession, logout, api } from './api.js';

const lazyPage = (load, name) => lazy(() => load().then((module) => ({ default: module[name] })));
const ProfilePage = lazyPage(() => import('./ProfilePage.jsx'), 'ProfilePage');
const PublicProfilePage = lazyPage(() => import('./ProfilePage.jsx'), 'PublicProfilePage');
const ProjectListPage = lazyPage(() => import('./ProjectPages.jsx'), 'ProjectListPage');
const ProjectDetailsPage = lazyPage(() => import('./ProjectPages.jsx'), 'ProjectDetailsPage');
const ProjectEditorPage = lazyPage(() => import('./ProjectPages.jsx'), 'ProjectEditorPage');
const OwnProposalsPage = lazyPage(() => import('./ProposalPages.jsx'), 'OwnProposalsPage');
const FreelancerPage = lazyPage(() => import('./FreelancerPage.jsx'), 'FreelancerPage');
const OwnInvitationsPage = lazyPage(() => import('./InvitationPages.jsx'), 'OwnInvitationsPage');
const OrderListPage = lazyPage(() => import('./OrderPages.jsx'), 'OrderListPage');
const OrderDetailsPage = lazyPage(() => import('./OrderPages.jsx'), 'OrderDetailsPage');
const MyReviewsPage = lazyPage(() => import('./Reviews.jsx'), 'MyReviewsPage');
const ComplaintsPage = lazyPage(() => import('./Complaints.jsx'), 'ComplaintsPage');
const WarningsPage = lazyPage(() => import('./Complaints.jsx'), 'WarningsPage');
const AdminPage = lazyPage(() => import('./AdminPage.jsx'), 'AdminPage');
const AuditPage = lazyPage(() => import('./AuditPage.jsx'), 'AuditPage');

function App() {
  const location = useLocation();

  usePreferences();

  const [user, setUser] = useState(null);
  const [restoring, setRestoring] = useState(true);
  const [notice, setNotice] = useState(
    new URLSearchParams(location.search).has('passwordChanged')
      ? t('Пароль изменён. Войдите с новым паролем.')
      : '',
  );
  const [restoreFailed, setRestoreFailed] = useState(false);

  async function restore() {
    setRestoring(true);
    setRestoreFailed(false);
    setNotice('');

    try {
      setUser(await restoreSession());
    } catch (error) {
      if (error.status !== 401) {
        setNotice(error.message);
        setRestoreFailed(error.status !== 403);
      }
    } finally {
      setRestoring(false);
    }
  }

  useEffect(() => {
    let active = true;

    restoreSession()
      .then((value) => {
        if (active) {
          setUser(value);
        }
      })
      .catch((error) => {
        if (active && error.status !== 401) {
          setNotice(error.message);
          setRestoreFailed(error.status !== 403);
        }
      })
      .finally(() => {
        if (active) {
          setRestoring(false);
        }
      });

    const handleSessionEnded = (event) => {
      setUser(null);
      setNotice(event.detail ?? uiMessage('Вы вышли из аккаунта'));
    };

    window.addEventListener('workify:session-ended', handleSessionEnded);

    return () => {
      active = false;
      window.removeEventListener('workify:session-ended', handleSessionEnded);
    };
  }, []);

  const [connection, setConnection] = useState('checking');
  const checkConnection = useCallback(async (signal) => {
    setConnection('checking');

    try {
      const timeout = AbortSignal.timeout(6000);
      const response = await fetch('/api/health', {
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
      const data = await response.json();

      if (!response.ok || data.status !== 'ok') {
        throw new Error('Service unavailable');
      }

      if (!signal?.aborted) {
        setConnection('ready');
      }
    } catch {
      if (!signal?.aborted) {
        setConnection('unavailable');
      }
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    checkConnection(controller.signal);

    return () => controller.abort();
  }, [checkConnection]);

  const labels = {
    checking: t('Проверяем подключение…'),
    ready: t('Подключение установлено'),
    unavailable: t('Сервис временно недоступен'),
  };
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
  const adminView = /^\/admin(?:\/(?:audit|(?:users|complaints)(?:\/[^/]+)?))?\/?$/.test(
    location.pathname,
  );
  const orderMatch = /^\/orders\/([^/]+)\/?$/.exec(location.pathname);
  const newProject = /^\/projects\/new\/?$/.test(location.pathname);
  const projectMatch = !newProject && /^\/projects\/([^/]+)(\/edit)?\/?$/.exec(location.pathname);
  const projectView = Boolean(
    catalog ||
    freelancers ||
    (projectMatch && (!projectMatch[2] || user)) ||
    ((newProject ||
      ownProjects ||
      ownProposals ||
      ownInvitations ||
      ownOrders ||
      ownReviews ||
      ownComplaints ||
      complaintMatch ||
      ownWarnings ||
      ownNotifications ||
      adminView ||
      orderMatch) &&
      user),
  );
  const knownRoute =
    location.pathname === '/' ||
    publicMatch ||
    ownProfile ||
    catalog ||
    ownProjects ||
    ownProposals ||
    freelancers ||
    ownInvitations ||
    ownOrders ||
    ownReviews ||
    ownComplaints ||
    complaintMatch ||
    ownWarnings ||
    ownNotifications ||
    adminView ||
    orderMatch ||
    newProject ||
    projectMatch;
  const profileView = Boolean(!knownRoute || publicMatch || (ownProfile && user) || projectView);
  const workspaceView = Boolean(
    user &&
    (location.pathname === '/' || location.pathname.startsWith('/me/') || adminView || orderMatch),
  );
  const welcomeView = !profileView;

  // Порядок проверок определяет страницу при пересечении условий маршрутов.
  function renderPageContent() {
    if (!knownRoute) {
      return (
        <section className="profile-card">
          <h1>{t('Страница не найдена')}</h1>
          <p>{t('Проверьте адрес или перейдите в каталог проектов.')}</p>
          <Link className="text-link" href="/projects">
            {t('Каталог проектов')}
          </Link>
        </section>
      );
    }

    if (projectView && restoring) {
      return (
        <div className="profile-card" role="status">
          {t('Загружаем рабочее пространство…')}
        </div>
      );
    }

    if (catalog) {
      return <ProjectListPage user={user} />;
    }

    if (freelancers) {
      return <FreelancerPage />;
    }

    if (ownProjects && user) {
      return <ProjectListPage user={user} mine />;
    }

    if (ownProposals && user) {
      return <OwnProposalsPage key={user.id} user={user} />;
    }

    if (ownInvitations && user) {
      return <OwnInvitationsPage key={user.id} user={user} />;
    }

    if (ownOrders && user) {
      return <OrderListPage key={user.id} user={user} />;
    }

    if (ownReviews && user) {
      return <MyReviewsPage key={user.id} user={user} />;
    }

    if ((ownComplaints || complaintMatch) && user) {
      return <ComplaintsPage key={user.id} user={user} complaintId={complaintMatch?.[1]} />;
    }

    if (ownNotifications && user) {
      return <NotificationsPage key={user.id} />;
    }

    if (ownWarnings && user) {
      return <WarningsPage key={user.id} user={user} />;
    }

    if (/^\/admin\/audit\/?$/.test(location.pathname) && user) {
      return <AuditPage key={user.id} user={user} />;
    }

    if (adminView && user) {
      return <AdminPage key={user.id} user={user} />;
    }

    if (orderMatch && user) {
      return <OrderDetailsPage key={user.id} user={user} orderId={orderMatch[1]} />;
    }

    if (newProject && user) {
      return <ProjectEditorPage user={user} />;
    }

    if (projectMatch && (!projectMatch[2] || user)) {
      if (projectMatch[2]) {
        return <ProjectEditorPage projectId={projectMatch[1]} user={user} />;
      }

      return <ProjectDetailsPage projectId={projectMatch[1]} user={user} />;
    }

    if (publicMatch) {
      return <PublicProfilePage userId={publicMatch[1]} user={user} />;
    }

    if (ownProfile && user) {
      return <ProfilePage user={user} onUserChange={setUser} />;
    }

    return (
      <>
        {user ? (
          <div className="profile-page-heading">
            <h1>{t('Аккаунт Workify')}</h1>
          </div>
        ) : (
          <section className="intro" aria-labelledby="welcome-title">
            <p className="eyebrow">{t('Ваше рабочее пространство')}</p>
            <h1 id="welcome-title">
              {t('Хорошие проекты')}
              <br />
              {t('начинаются с людей.')}
            </h1>
            <p className="lead">
              {t(
                'Workify объединяет заказчика и исполнителя: от первого предложения до принятого результата.',
              )}
            </p>
            <div className="discovery-links">
              <Link className="button-link" href="/projects">
                {t('Каталог проектов')}
                <Icon name="arrow-up-right" />
              </Link>
              <Link className="secondary button-link" href="/freelancers">
                {t('Исполнители')}
                <Icon name="user" />
              </Link>
            </div>
            <div className="connection" role="status" aria-live="polite">
              <span className={`indicator indicator-${connection}`} aria-hidden="true" />
              <span>{labels[connection]}</span>
            </div>
            <button
              type="button"
              onClick={() => checkConnection()}
              disabled={connection === 'checking'}
            >
              {t('Проверить подключение ')}
              <span aria-hidden="true">↗</span>
            </button>
          </section>
        )}
        <aside
          className={user ? 'auth-area account-area' : 'auth-area'}
          aria-label={t('Аккаунт Workify')}
        >
          {user ? (
            <AccountPanel
              user={user}
              onLogout={logout}
              onRefresh={async () => {
                const result = await api('/auth/me');

                setUser(result.user);

                return uiMessage('Данные аккаунта обновлены');
              }}
              onAdminCheck={async () => {
                await api('/admin/access');

                return uiMessage('Доступ администратора подтверждён');
              }}
            />
          ) : (
            <AuthPanel
              restoring={restoring}
              notice={
                new URLSearchParams(location.search).has('passwordChanged')
                  ? t('Пароль изменён. Войдите с новым паролем.')
                  : notice
              }
              onAuthenticate={async (mode, values) => {
                setUser(await authenticate(mode, values));
                setNotice('');
                setRestoreFailed(false);

                const next =
                  new URLSearchParams(location.search).get('returnTo') ??
                  (location.pathname !== '/' ? location.href : null);

                if (next?.startsWith('/') && isAppUrl(next)) {
                  navigate(next);
                } else if (location.pathname !== '/') {
                  navigate('/');
                }
              }}
            />
          )}
          {restoreFailed && !restoring && !user && (
            <button className="restore-button secondary" onClick={restore}>
              {t('Повторить восстановление сессии')}
            </button>
          )}
        </aside>
        {user && (
          <div className="account-connection">
            <div className="connection" role="status">
              <span className={`indicator indicator-${connection}`} aria-hidden="true" />
              <span>{labels[connection]}</span>
            </div>
            <button
              className="text-button"
              onClick={() => checkConnection()}
              disabled={connection === 'checking'}
            >
              {t('Проверить подключение')}
            </button>
          </div>
        )}
      </>
    );
  }

  return (
    <div className="page">
      <Link className="skip-link" href="#main-content">
        {t('К содержимому')}
      </Link>
      <header className="header">
        <div className="header-inner">
          <Link className="brand" href="/" aria-label={t('Workify — главная')}>
            <img
              className="brand-light"
              src="/assets/workify/brand/workify-wordmark-light.svg"
              alt="Workify"
            />
            <img
              className="brand-dark"
              src="/assets/workify/brand/workify-wordmark-dark.svg"
              alt="Workify"
            />
          </Link>
          <SiteNavigation />
          <div className="header-actions">
            <Preferences />
            {user && <NotificationLink key={user.id} current={ownNotifications} />}
            <Link
              className="secondary button-link workspace-link"
              href={user ? '/me/profile' : '/'}
            >
              {user ? t('Личный кабинет') : t('Войти')}
              <Icon name="user" />
            </Link>
            <MobileNavigation user={user} />
          </div>
        </div>
      </header>
      <div className={`app-layout${workspaceView ? ' app-layout-workspace' : ''}`}>
        {workspaceView && <WorkspaceNavigation user={user} />}
        <RouteFocus />
        <main
          id="main-content"
          tabIndex={-1}
          className={welcomeView ? (user ? 'account-main' : 'welcome-main') : 'profile-main'}
        >
          <Suspense
            fallback={
              <div className="profile-card" role="status">
                {t('Загружаем рабочее пространство…')}
              </div>
            }
          >
            <React.Fragment key={`${location.pathname}${location.search}:${user?.id ?? 'guest'}`}>
              {renderPageContent()}
            </React.Fragment>
          </Suspense>
        </main>
      </div>
      <footer>
        <span>Workify</span>
        <span>{t('Для работы, у которой есть результат.')}</span>
      </footer>
    </div>
  );
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

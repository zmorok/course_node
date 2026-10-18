import React, { useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { AuthPanel, AccountPanel } from './AuthPanel.jsx';
import { authenticate, restoreSession, logout, api } from './api.js';

function App() {
  const [user, setUser] = useState(null);
  const [restoring, setRestoring] = useState(true);
  const [notice, setNotice] = useState('');
  const [restoreFailed, setRestoreFailed] = useState(false);
  async function restore() {
    setRestoring(true); setRestoreFailed(false); setNotice('');
    try { setUser(await restoreSession()); }
    catch (error) {
      if (error.status !== 401) { setNotice(error.message); setRestoreFailed(error.status !== 403); }
    } finally { setRestoring(false); }
  }
  useEffect(() => {
    let active = true;
    restoreSession().then(value => { if (active) setUser(value); }).catch(error => {
      if (active && error.status !== 401) { setNotice(error.message); setRestoreFailed(error.status !== 403); }
    }).finally(() => { if (active) setRestoring(false); });
    const ended = event => { setUser(null); setNotice(event.detail ?? 'Вы вышли из аккаунта'); };
    window.addEventListener('workify:session-ended', ended);
    return () => { active = false; window.removeEventListener('workify:session-ended', ended); };
  }, []);
  const [connection, setConnection] = useState('checking');
  const checkConnection = useCallback(async signal => {
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

  const labels = { checking: 'Проверяем подключение…', ready: 'Подключение установлено', unavailable: 'Сервис временно недоступен' };
  return (
    <div className="page">
      <header className="header">
        <a className="brand" href="/" aria-label="Workify — главная"><span className="brand-mark">w.</span>workify</a>
        <span className="header-note">IT-проекты · люди · результат</span>
      </header>
      <main>
        <section className="intro" aria-labelledby="welcome-title">
          <p className="eyebrow">Ваше рабочее пространство</p>
          <h1 id="welcome-title">Хорошие проекты<br />начинаются с людей.</h1>
          <p className="lead">Workify объединяет заказчика и исполнителя: от первого предложения до принятого результата.</p>
          <div className="connection" role="status" aria-live="polite">
            <span className={`indicator indicator-${connection}`} aria-hidden="true" />
            <span>{labels[connection]}</span>
          </div>
          <button type="button" onClick={() => checkConnection()} disabled={connection === 'checking'}>Проверить подключение <span aria-hidden="true">↗</span></button>
        </section>
        <aside className="auth-area" aria-label="Аккаунт Workify">
          {user ? <AccountPanel user={user} onLogout={logout}
            onRefresh={async () => { const result = await api('/auth/me'); setUser(result.user); return 'Данные аккаунта обновлены'; }}
            onAdminCheck={async () => { await api('/admin/access'); return 'Доступ администратора подтверждён'; }} />
            : <AuthPanel restoring={restoring} notice={notice} onAuthenticate={async (mode, values) => { setUser(await authenticate(mode, values)); setNotice(''); setRestoreFailed(false); }} />}
          {restoreFailed && !restoring && !user && <button className="restore-button secondary" onClick={restore}>Повторить восстановление сессии</button>}
        </aside>
      </main>
      <footer><span>Workify</span><span>Для работы, у которой есть результат.</span></footer>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<React.StrictMode><App /></React.StrictMode>);

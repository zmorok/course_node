import React, { useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

function App() {
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
        <aside className="workspace" aria-label="Возможности рабочего пространства">
          <div className="workspace-top"><span>Всё в одном пространстве</span><span aria-hidden="true">↗</span></div>
          <ol>
            <li><span className="step">01</span><div><h2>Сформулировать задачу</h2><p>Описание проекта и ожидаемый результат.</p></div></li>
            <li><span className="step">02</span><div><h2>Найти друг друга</h2><p>Отклики и приглашения к сотрудничеству.</p></div></li>
            <li><span className="step">03</span><div><h2>Довести до результата</h2><p>Работа, обратная связь и приёмка.</p></div></li>
          </ol>
          <p className="workspace-note">Рабочее пространство готовится.<br />Разделы проектов и заказов появятся здесь позже.</p>
        </aside>
      </main>
      <footer><span>Workify</span><span>Для работы, у которой есть результат.</span></footer>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<React.StrictMode><App /></React.StrictMode>);

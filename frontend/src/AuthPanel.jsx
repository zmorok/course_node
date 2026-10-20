import { t, locale } from "./i18n.js";import React, { useState } from 'react';
import { ErrorMessage } from './Ui.jsx';

const fields = {
  firstName: [t("Имя"), 'text', 'given-name'], lastName: [t("Фамилия"), 'text', 'family-name'],
  username: [t("Имя пользователя"), 'text', 'username'], email: ['Email', 'email', 'email'],
  password: [t("Пароль"), 'password', 'current-password']
};

export function AuthPanel({ onAuthenticate, restoring, notice }) {
  const [mode, setMode] = useState('login');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(null);
  const [visible, setVisible] = useState(false);
  const isRegister = mode === 'register';
  async function submit(event) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    if (isRegister && values.password !== values.confirmPassword) {
      setProblem({ message: t("Пароли не совпадают"), details: [{ field: 'body.confirmPassword', message: t("Повторите тот же пароль") }] });
      return;
    }
    delete values.confirmPassword;
    setProblem(null);
    setBusy(true);
    try {await onAuthenticate(mode, values);}
    catch (error) {setProblem(error);} finally
    {setBusy(false);}
  }
  const names = isRegister ? ['firstName', 'lastName', 'username', 'email', 'password', 'confirmPassword'] : ['email', 'password'];
  return (
    <section className={`auth-card${isRegister ? ' auth-card-register' : ''}`} aria-labelledby="auth-title">
      <div className="auth-tabs" aria-label={t("Доступ к аккаунту")}>
        {[['login', t("Вход")], ['register', t("Регистрация")]].map(([value, label]) => <button key={value} type="button"
        className={mode === value ? 'tab active' : 'tab'} aria-pressed={mode === value} disabled={busy || restoring}
        onClick={() => {setMode(value);setProblem(null);setVisible(false);}}>{label}</button>)}
      </div>
      {!isRegister && <p className="eyebrow">{t("С возвращением")}</p>}
      <h2 id="auth-title">{isRegister ? t("Создать аккаунт") : t("Войти в рабочее пространство")}</h2>
      <p className="auth-description">{isRegister ? t("Один аккаунт — для своих проектов и работы исполнителем.") : t("Продолжите работу над тем, что важно.")}</p>
      {restoring ? <p role="status">{t("Восстанавливаем сессию…")}</p> : <>
        <ErrorMessage error={problem} />
        {!problem && notice && <p className="form-notice" role="status">{notice}</p>}
        <form key={mode} onSubmit={submit} aria-busy={busy}>
          <fieldset disabled={busy}>
            <div className={isRegister ? 'form-fields register-fields' : 'form-fields'}>
              {names.map((name) => {
                const [label, type, complete] = fields[name] ?? [t("Повторите пароль"), 'password', 'new-password'];
                const issue = problem?.details?.find((item) => item.field === `body.${name}`);
                return <div className={`field field-${name}`} key={name}>
                  <label htmlFor={`auth-${name}`}>{label}</label>
                  <input id={`auth-${name}`} name={name} type={type === 'password' && visible ? 'text' : type} required
                  autoComplete={name === 'password' && isRegister ? 'new-password' : complete}
                  minLength={name === 'password' && isRegister ? 12 : name === 'username' ? 3 : undefined}
                  maxLength={type === 'password' ? 128 : name === 'email' ? 254 : name === 'username' ? 40 : 100}
                  pattern={name === 'username' ? '[A-Za-z0-9_]{3,40}' : undefined}
                  aria-invalid={Boolean(issue)} aria-describedby={issue ? `${name}-error` : name === 'password' && isRegister ? 'password-hint' : name === 'username' ? 'username-hint' : undefined} />
                  {name === 'username' && <small id="username-hint">{t("3–40 символов: латиница, цифры и _")}</small>}
                  {name === 'password' && isRegister && <small id="password-hint">{t("От 12 до 128 символов. Пробелы учитываются.")}</small>}
                  {issue && <small className="field-error" id={`${name}-error`}>{issue.message}</small>}
                </div>;
              })}
            </div>
            <label className="show-password"><input type="checkbox" checked={visible} onChange={(event) => setVisible(event.target.checked)} />{t("Показать пароль")}</label>
            <button className="submit" type="submit">{busy ? t("Подождите…") : isRegister ? t("Создать аккаунт") : t("Войти")}<span aria-hidden="true">↗</span></button>
          </fieldset>
        </form>
      </>}
      {!isRegister && <p className="auth-footnote">{t("Сессия восстановится при следующем посещении.")}</p>}
    </section>);

}

export function AccountPanel({ user, onLogout, onRefresh, onAdminCheck }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  async function run(action) {
    setBusy(true);setMessage('');
    try {const result = await action();if (result) setMessage(result);}
    catch (error) {setMessage(error.message);} finally
    {setBusy(false);}
  }
  return <section className="auth-card account-card" aria-labelledby="account-title">
    <div className="account-top"><span className="avatar" aria-hidden="true">{user.firstName.slice(0, 1)}</span><span className="role-badge">{user.role === 'ADMIN' ? t("Администратор") : t("Клиент")}</span></div>
    <p className="eyebrow">{t("Вы в Workify")}</p>
    <h2 id="account-title">{user.firstName} {user.lastName}</h2>
    <p className="account-username">@{user.username}</p><p className="account-email">{user.email}</p>
    <div className="account-info">{user.role === 'ADMIN' ? t("Рассматривайте жалобы, изучайте историю заказов и управляйте ограничениями клиентов.") : t("Вы можете быть заказчиком и исполнителем. Заполните профиль и укажите свои навыки.")}</div>
    <div className="account-actions">
      <a className="button-link" href="/me/profile">{t("Мой профиль")}<span aria-hidden="true">↗</span></a>
      {user.role === 'CLIENT' && <a className="button-link" href="/me/projects">{t("Мои проекты")}<span aria-hidden="true">↗</span></a>}
      {user.role === 'CLIENT' && <a className="button-link" href="/me/orders">{t("Мои заказы")}<span aria-hidden="true">↗</span></a>}
      <button type="button" disabled={busy} onClick={() => run(onRefresh)}>{t("Обновить данные")}<span aria-hidden="true">↻</span></button>
      {user.role === 'ADMIN' && <a className="button-link" href="/admin/complaints">{t("Административная панель")}<span aria-hidden="true">↗</span></a>}
      {user.role === 'ADMIN' && <button type="button" disabled={busy} onClick={() => run(onAdminCheck)}>{t("Проверить доступ администратора")}</button>}
      <button type="button" className="secondary" disabled={busy} onClick={() => run(onLogout)}>{t("Выйти из аккаунта")}</button>
    </div>
    {message && <p role="status" className="account-message">{message}</p>}
  </section>;
}
